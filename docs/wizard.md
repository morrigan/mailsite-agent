# Setup wizard inputs

`node mailsite-agent/bin/mailsite-setup` asks the questions below, in this order,
and writes `clients.json` and `.env` from your answers. You can leave any
credential blank and fill it into `.env` later; the wizard writes the file either
way. This page explains what each prompt is and where to find the value.

## Choices

- **Which agent will run this?** Claude Code or Goose. This sets the
  `active-agent` symlink. Pick whichever agent CLI you have installed.
- **Read provider / Send provider.** Which mail service receives requests and
  which one sends replies. They can differ. See [providers.md](providers.md) for
  the full matrix; the short version is that reading needs Gmail or IMAP, and
  sending can also use Resend.
- **Hosting provider for this site.** Netlify, Cloudflare Pages, or Cloudflare Workers. See
  [hosting.md](hosting.md).
- **How will you run it?** Native (launchd/cron on this machine) or Docker. This
  only changes the closing instructions and an optional launchd step.
- **Install IMAP packages / Install the launchd scheduler.** Yes/no prompts shown
  only when relevant. Safe to answer no and do it later.

## Mail addresses

- **Address owners email their changes to.** The mailbox your read provider
  polls, for example `updates@yourdomain.com`. Owners send change requests here.
- **Your email.** Where the agent sends alerts when a run needs a human
  (`NeedsHuman`). Defaults to the update address.

## Mail credentials

### Gmail

Needs an OAuth client and a refresh token for the mailbox that receives updates.
Full step-by-step, with where each value lives and how long it lasts, is in
[gmail-setup.md](gmail-setup.md).

- **GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET.** From a Web-application OAuth client
  you create in the Google Cloud Console (APIs & Services → Credentials), after
  enabling the Gmail API. The ID and secret show on the client's page.
- **GMAIL_REFRESH_TOKEN.** Mint it once with the
  [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/) using
  your own client credentials and the scopes
  `https://www.googleapis.com/auth/gmail.modify` and `.../gmail.send`. Publish the
  consent screen to Production so it does not expire after 7 days.

### IMAP / SMTP (including ProtonMail)

- **IMAP_HOST / IMAP_PORT / IMAP_USER / IMAP_PASSWORD.** Your mailbox's incoming
  settings. For ProtonMail, install [Proton Mail Bridge](https://proton.me/mail/bridge)
  (a paid plan); it runs a local server and shows the host (`127.0.0.1`), the
  IMAP port (`1143`), your address as the username, and a Bridge-specific
  password. For Fastmail, iCloud, or Gmail-over-IMAP, use the provider's host and
  an app password, not your login password.
- **SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASSWORD.** The outgoing settings
  from the same provider (Proton Bridge's SMTP port defaults to `1025`). They
  default to the IMAP values where they match.
- **SMTP_FROM.** The address replies are sent from. Defaults to the update
  address.

### Resend

- **RESEND_API_KEY.** In the [Resend dashboard](https://resend.com/api-keys),
  create an API key.
- **Verified "From".** The sender address, like `Updates <updates@you.com>`. The
  domain must be verified under Resend's Domains section, or sending fails.

## First client

The site you hand off. One client now; add more later with
[onboarding.md](onboarding.md).

- **Client id (slug).** A short lowercase name (letters, numbers, hyphens). It is
  also the `sites/<id>` directory and the update-branch prefix.
- **Display name.** A human-readable name for the business. Defaults to the id.
- **Authorized sender email(s).** The exact `From` addresses allowed to request
  changes, comma-separated. Anything else is rejected.
- **Secret word.** A shared word the owner must include in the email body, 6+
  characters. It is a second check on top of the sender allowlist, because a
  `From` header can be faked. Share it with the owner privately.
- **Production branch.** The branch that deploys to the live site, usually
  `main`.
- **Reply-to address.** Where confirmations go. Defaults to the first authorized
  sender.
- **Where images live in the repo.** A path like `assets/img`, so the agent
  places uploaded photos where the site already keeps images. Optional.

## Hosting

### Netlify

- **Netlify site name.** The subdomain in `your-site.netlify.app`. Find or change
  it under Site configuration, Site details, Site name.
- **Netlify site API ID.** A UUID under Site configuration, Site details, labeled
  Site ID. Used to poll deploy state.
- **NETLIFY_AUTH_TOKEN.** A personal access token from User settings,
  Applications, Personal access tokens, New token.

### Cloudflare Pages

- **Cloudflare Pages project name.** The project's name under Workers & Pages in
  the [Cloudflare dashboard](https://dash.cloudflare.com/).
- **Cloudflare account id.** The hex string shown in the dashboard URL
  (`dash.cloudflare.com/<account-id>`), and in the account's Workers & Pages
  overview. Leave the prompt blank to read it from `CLOUDFLARE_ACCOUNT_ID`
  instead.
- **CLOUDFLARE_API_TOKEN.** Create it under My Profile, API Tokens, Create Token.
  Give it the Cloudflare Pages Read permission (Edit if you later add direct
  uploads).

### Cloudflare Workers

Pick this if your site is a Worker (including a Worker that serves static assets)
rather than a Pages project.

- **Cloudflare Worker (script) name.** The Worker's name under Workers & Pages in
  the [Cloudflare dashboard](https://dash.cloudflare.com/). It must be connected
  to the site's git repo (Workers Builds) with preview URLs on, so pushes build.
- **Cloudflare account id.** Same as above: the hex string in the dashboard URL,
  or leave blank to use `CLOUDFLARE_ACCOUNT_ID`.
- **CLOUDFLARE_API_TOKEN.** Give this token the Workers Scripts Read permission.
  The preview URL uses your `*.workers.dev` subdomain, which the agent reads from
  the API automatically; set `subdomain` in `clients.json` only to override it.
