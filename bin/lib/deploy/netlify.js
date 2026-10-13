'use strict';
// Netlify deploy provider. Deploys are triggered by git push (the site repo is
// linked to Netlify with PR/branch deploy previews); this provider observes
// deploy state via the REST API and resolves the preview/production URL.
//
// Env: NETLIFY_AUTH_TOKEN
// Hosting config (per client): hosting.netlify = { siteName, siteId }

const { die } = require('../common');

const API = 'https://api.netlify.com/api/v1';

function token() { return process.env.NETLIFY_AUTH_TOKEN || die('Missing NETLIFY_AUTH_TOKEN in .env'); }

async function napi(tok, p) {
  const res = await fetch(API + p, { headers: { Authorization: `Bearer ${tok}` } });
  if (!res.ok) die(`Netlify API ${p} → ${res.status} ${await res.text()}`);
  return res.json();
}

const normalize = (s) => (s === 'ready' ? 'ready' : s === 'error' ? 'error' : 'building');
const terminal = (d) => d.state === 'ready' || d.state === 'error';

module.exports = {
  async preview(cfg, client, host, { branch, pr }, poll) {
    const tok = token();
    const siteId = host.netlify.siteId || die('hosting.netlify.siteId required');
    const hit = await poll(async () => {
      const deploys = await napi(tok, `/sites/${siteId}/deploys?per_page=30`);
      const d = deploys.find((x) => x.branch === branch && (x.context === 'deploy-preview' || x.context === 'branch-deploy'));
      return { done: !!(d && terminal(d)), value: d };
    });
    if (!hit) return { state: 'timeout', url: null };
    const url = hit.deploy_ssl_url || hit.deploy_url ||
      (pr ? `https://deploy-preview-${pr}--${host.netlify.siteName}.netlify.app` : null);
    return { state: normalize(hit.state), url, deployId: hit.id };
  },

  async publish(cfg, client, host, _opts, poll) {
    const tok = token();
    const siteId = host.netlify.siteId || die('hosting.netlify.siteId required');
    const hit = await poll(async () => {
      const deploys = await napi(tok, `/sites/${siteId}/deploys?per_page=10`);
      const d = deploys.find((x) => x.context === 'production');
      return { done: !!(d && terminal(d)), value: d };
    });
    if (!hit) return { state: 'timeout', url: null };
    return { state: normalize(hit.state), url: hit.ssl_url || hit.url || null, deployId: hit.id };
  },
};
