# Gmail API setup

The `gmail` mail provider needs three values in your hub `.env`:

```
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...
```

They all come from one Google account: the mailbox that receives update emails
(your `updateAddress`). This page shows where to get each one. It takes about ten
minutes and you only do it once.

## 1. Create or pick a Google Cloud project

Go to the [Google Cloud Console](https://console.cloud.google.com/). Use the
project picker at the top to create a new project (any name) or select one.

## 2. Enable the Gmail API

APIs & Services → Library → search "Gmail API" → open it → Enable.

## 3. Configure the OAuth consent screen

APIs & Services → OAuth consent screen.

- User type: External.
- Fill in the app name and your email where required.
- Scopes: you can leave the scope list here empty; you pick scopes in the
  Playground later.
- Test users: add the mailbox address (`belma.dzi@gmail.com` in this setup).
- **Publishing status: click "Publish app" to move it to Production.** While it
  is in "Testing", refresh tokens expire after 7 days, which would stop the
  scheduler after a week. In Production they do not expire from inactivity unless
  unused for 6 months (the scheduler uses it constantly, so this never happens).

## 4. Create the OAuth client (where the ID and secret come from)

APIs & Services → Credentials → Create credentials → OAuth client ID.

- Application type: **Web application** (needed for the Playground step below).
- Authorized redirect URIs → Add URI → paste exactly:
  `https://developers.google.com/oauthplayground`
- Create.

A dialog shows your **Client ID** and **Client secret**. You can also find them
any time at APIs & Services → Credentials → under "OAuth 2.0 Client IDs" click
the client's name; the ID and secret are on that page, with a download button
for the JSON. These are `GMAIL_CLIENT_ID` and `GMAIL_CLIENT_SECRET`.

## 5. Get the refresh token

### Easiest: the built-in helper

`mailsite-gmail-auth` mints the token against the exact client in your `.env`, so
it can't end up tied to the wrong client (the usual `unauthorized_client` cause),
and it requests both scopes so you can't hit a 403. Make the OAuth client a
**Desktop app** (then there's no redirect URI to register), put its id/secret in
`.env`, and run from the hub root:

```bash
node mailsite-agent/bin/mailsite-gmail-auth
```

Open the URL it prints, sign in as the mailbox you read, allow (click through the
"unverified app" warning for your own app), and it writes `GMAIL_REFRESH_TOKEN`
into `.env`. If you keep a Web-application client instead, add
`http://localhost:8402` as an authorized redirect URI first (or set
`MAILSITE_OAUTH_PORT`).

### Or by hand: the OAuth Playground

Open the [OAuth 2.0 Playground](https://developers.google.com/oauthplayground/).

1. Click the gear icon (top right) → tick **Use your own OAuth credentials** →
   paste your Client ID and Client secret → close.
2. In the left "Input your own scopes" box, enter these two, space or newline
   separated:
   - `https://www.googleapis.com/auth/gmail.modify`
   - `https://www.googleapis.com/auth/gmail.send`
3. Click **Authorize APIs**. Sign in as the update mailbox and allow access.
   (If you see an "unverified app" warning because the app is yours, continue
   past it.)
4. On step 2 of the Playground, click **Exchange authorization code for tokens**.
5. Copy the **Refresh token** value. That is `GMAIL_REFRESH_TOKEN`.

The two scopes are all the provider needs: `gmail.modify` to read messages and
set the `WebUpdate/*` labels, and `gmail.send` to reply.

## 6. Put them in .env

Edit the hub `.env` (not committed) and set the three values. Then confirm the
provider can read the inbox (this only lists, it changes nothing):

```bash
node mailsite-agent/bin/mailsite-mail fetch-new
```

An empty `[]` or a list of messages both mean success. An error naming the
missing variables means `.env` is not set yet.

## How long the credentials last

- The refresh token is long-lived and is not rotated by hand. The code exchanges
  it for a fresh one-hour access token on every run, so there is nothing to
  refresh yourself.
- It keeps working as long as the consent screen is **Published** (not Testing),
  the account's password is not reset in a way that revokes grants, and you do
  not revoke the app's access at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- Google also evicts the oldest refresh token once a single client has more than
  50 outstanding for one account, so avoid re-running the Playground many times.

## If it stops working

A revoked or expired token makes the Gmail call fail with `invalid_grant`. The
tick then fails and the self-healing loop raises `logs/NEEDS_ATTENTION` rather
than stalling silently. Redo step 5 to mint a new refresh token and update
`.env`. If you had left the app in Testing, publish it to Production first so it
does not happen again.

Other errors seen at `fetch-new`:

- `unauthorized_client` (401): the refresh token was issued by a different OAuth
  client than the id/secret in `.env`. Re-mint with the helper (it uses your
  client) or make sure the Playground had "Use your own OAuth credentials" ticked.
- `insufficient authentication scopes` (403): the token was granted without
  `gmail.modify` (needed to read and label). Re-mint authorizing **both**
  `gmail.modify` and `gmail.send`. The helper always requests both.
