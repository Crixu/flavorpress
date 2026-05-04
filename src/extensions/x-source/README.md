# Self-hosting Nitter for the X source

Public Nitter mirrors (xcancel.com and friends) block requests that look like RSS readers, and the official X API starts at $200/month. The supported workaround is to run your own Nitter instance and point FlavorPress at it via the bridge template setting.

This guide is for one prosumer with one site. It is not a multi-tenant deployment plan.

## What you are setting up

Nitter is a lightweight front-end for X that exposes per-handle RSS feeds at `https://your-instance/{handle}/rss`. FlavorPress already polls RSS, so once Nitter is running you only need to paste `https://your-instance/{handle}/rss` into Settings → X (Twitter) RSS bridge template.

Since 2024 Nitter requires authenticated session cookies from real X accounts; guest tokens no longer work. You will need one or two throwaway X accounts whose session cookies the instance uses to fetch tweets. Use accounts you do not care about; X bans them periodically.

## What you need

- A small VPS or PaaS slot (Fly.io, Railway, Hetzner CX11, a Raspberry Pi at home; ~256 MB RAM is enough).
- Docker and Docker Compose, or the ability to run a single Go binary.
- One or two throwaway X accounts with email + password login (no 2FA, or 2FA you can complete once during setup).
- A domain or subdomain you control if you want HTTPS. Optional for personal use; required if you ever want to use the same instance from a phone or another device.

## Option A: Docker Compose (recommended)

Create a directory for the deployment.

```sh
mkdir nitter-flavorpress && cd nitter-flavorpress
```

Save this as `docker-compose.yml`:

```yaml
services:
  nitter:
    image: zedeus/nitter:latest
    container_name: nitter
    ports:
      - "8080:8080"
    volumes:
      - ./nitter.conf:/src/nitter.conf:Z,ro
      - ./sessions.jsonl:/src/sessions.jsonl:Z,ro
    depends_on:
      - nitter-redis
    restart: unless-stopped

  nitter-redis:
    image: redis:7-alpine
    container_name: nitter-redis
    command: redis-server --save 60 1 --loglevel warning
    volumes:
      - nitter-redis:/data
    restart: unless-stopped

volumes:
  nitter-redis:
```

Save this as `nitter.conf`. Generate a random `hmacKey` with `openssl rand -hex 32`.

```ini
[Server]
address = "0.0.0.0"
port = 8080
https = false
httpMaxConnections = 100
staticDir = "./public"
title = "nitter"
hostname = "your-instance.example.com"

[Cache]
listMinutes = 240
rssMinutes = 10
redisHost = "nitter-redis"
redisPort = 6379
redisPassword = ""
redisConnections = 20
redisMaxConnections = 30

[Config]
hmacKey = "PASTE-OPENSSL-RAND-HEX-32-OUTPUT-HERE"
base64Media = false
enableRSS = true
enableDebug = false
proxy = ""
proxyAuth = ""
tokenCount = 10

[Preferences]
theme = "Nitter"
replaceTwitter = ""
replaceYouTube = ""
replaceReddit = ""
replaceInstagram = ""
proxyVideos = true
hlsPlayback = false
infiniteScroll = false
```

Generate session cookies for your throwaway accounts. Nitter's current instructions live at https://github.com/zedeus/nitter/wiki/Creating-session-tokens; use `tools/create_session_browser.py` or `tools/create_session_curl.py` from the Nitter repo to append each account to `sessions.jsonl`. One or two sessions are plenty for personal traffic.

Place `sessions.jsonl` next to `docker-compose.yml`, then start it.

```sh
docker compose up -d
```

Verify it works.

```sh
curl -s http://localhost:8080/jack/rss | head -40
```

You should see RSS XML with recent tweets. If you get an empty feed or a "no accounts available" page, the session in `sessions.jsonl` was rejected; generate a fresh one.

## Option B: Fly.io

Same Docker image, no VPS to maintain. Costs roughly $2–4/month for the always-on Nitter instance plus a tiny Redis.

```sh
fly launch --image zedeus/nitter:latest --no-deploy
```

Edit the generated `fly.toml` to mount `nitter.conf` and `sessions.jsonl` as secrets (or use `fly volumes` for the conf file), then `fly deploy`. Add a Redis Upstash add-on or run a second Fly app for Redis; point `redisHost` at it. The Nitter wiki has a working `fly.toml` example.

## Wiring it into FlavorPress

In the running app, go to Settings, scroll to **X (Twitter) RSS bridge template**, and paste your instance URL.

```
https://your-instance.example.com/{handle}/rss
```

If you only run it locally for development, `http://localhost:8080/{handle}/rss` is fine.

Save. Then add an X source as `@handle`, a profile URL, or a tweet URL; FlavorPress will resolve it through your bridge.

You can also set this via env var instead of the settings UI:

```
X_BRIDGE_TEMPLATE=https://your-instance.example.com/{handle}/rss
```

The settings value wins if both are present.

## Operating notes

- Sessions die. When `curl /handle/rss` starts returning empty feeds, regenerate `sessions.jsonl` and `docker compose restart nitter`. Expect this every few weeks.
- Cache the RSS aggressively in `nitter.conf` (`rssMinutes = 10` or higher). FlavorPress polls every few minutes; without caching you will burn session quota.
- Do not advertise the instance publicly. A private hostname plus basic auth at the reverse proxy is enough; if it shows up on a Nitter mirror list, it gets scraped to death and your sessions are exhausted in a day.
- Keep two accounts in `sessions.jsonl` so a single ban does not take the bridge down.

## When to give up on Nitter

Self-hosting only buys you a few weeks at a time. If you find yourself regenerating sessions weekly, the better answer is usually:

1. Switch to newsletter forwarding for any author who cross-posts; FlavorPress already accepts forwarded newsletters at `/api/inbound`.
2. Use a paid scraper key (SocialData, apidance, twitterapi.io); cents per thousand tweets, not hundreds of dollars per month.

Both are out of scope for this README; the bridge template setting accepts any URL with `{handle}`, so swapping providers is a one-line change in Settings.
