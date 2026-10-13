# Onboarding a new client site

Do this once per site you hand off. (Mail providers are configured once,
globally — see [providers.md](providers.md) — not per client.)

## 1. The site must be a GitHub repo on Netlify with PR previews

- The static site lives in its own GitHub repo.
- The repo is linked to a Netlify site.
- **Deploy Previews are enabled** (Netlify → Site → Build & deploy → Deploy
  Previews → "Deploy Previews from Pull Requests"). This is what gives the owner
  a preview URL before anything goes live.

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
  "netlifySiteName": "their-netlify-site",     // from the *.netlify.app subdomain
  "netlifySiteId": "<site API ID>",            // Netlify → Site settings → General
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

> To change your website, email **<updateAddress>** and include the word
> **"<secretWord>"** somewhere in your message. Describe what you'd like changed
> in normal English, and attach any photos. You'll get a reply with a preview
> link — reply **"approve"** to publish it, or just tell us what to fix.

That's it. The scheduled agent picks it up on its next tick.

## Notes on the secret word

It defeats trivial `From`-header spoofing, but it is a shared secret, not strong
auth. The real safety net is that **nothing publishes without an explicit
approval reply**. For higher assurance later, see the "Future" section of the
project plan (SPF/DKIM checks, magic-link confirmation).
