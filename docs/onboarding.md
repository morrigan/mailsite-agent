# Onboarding a new client site

Do this once per site you hand off. Mail providers are set up globally, not per
client; see [providers.md](providers.md).

## 1. The site must be a GitHub repo on a host with branch/PR previews

- The static site lives in its own GitHub repo.
- The repo is connected to a hosting provider ([Netlify or Cloudflare Pages](hosting.md)).
- Deploy previews are on, so a branch or PR gets a preview URL before anything
  goes live:
  - Netlify: Site → Build & deploy → Deploy Previews → "from Pull Requests".
  - Cloudflare Pages: preview deployments are on by default for non-production
    branches.

## 2. Clone it into the hub

```bash
cd <hub>
git clone git@github.com:owner/their-site.git sites/<client-id>
```

## 3. Add a `clients.json` entry

```jsonc
{
  "id": "their-slug",
  "name": "Their Business",
  "authorizedSenders": ["owner@example.com"],
  "secretWord": "pick-something-memorable",   // 6+ chars; share privately
  "repoPath": "sites/their-slug",
  "productionBranch": "main",
  "hosting": {                                 // pick one, see docs/hosting.md
    "provider": "netlify",
    "netlify": { "siteName": "their-netlify-site", "siteId": "<site API ID>" }
    // or: "provider": "cloudflare", "cloudflare": { "projectName": "their-project" }
  },
  "replyTo": "owner@example.com",
  "assetDirHint": "assets/img"                 // optional: where images live
}
```

Validate it against the schema:

```bash
npx --yes ajv-cli validate -s mailsite-agent/clients.schema.json -d clients.json
```

## 4. Give the owner a one-pager

Tell them, in plain language:

> To change your website, email <updateAddress> and include the word
> "<secretWord>" in the subject or anywhere in the message. Describe what you'd like changed in
> normal English, and attach any photos. You'll get a reply with a preview link.
> Reply "approve" to publish it, or tell us what to fix.

That's it. The scheduled agent picks it up on its next tick.

## Notes on the secret word

It defeats trivial `From`-header spoofing, but it is a shared secret, not strong
auth. The real safety net is that nothing publishes without an explicit approval
reply. For stronger assurance later, see the hardening ideas in
[security.md](security.md): SPF/DKIM checks and a magic-link confirmation.
