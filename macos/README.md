# FlavorPress macOS app

Self-contained SwiftUI app: ships a pinned Node binary plus the Next.js standalone bundle inside `Contents/Resources/`, spawns the server on a random localhost port at launch, and loads it in a `WKWebView`. No `npm` or Node required on the user's machine to run the .app.

Closing the window keeps the app and its server running; the dock icon reopens it. There's a "Launch at Login" toggle in the menu (uses `SMAppService.mainApp`, no helper bundle).

## Build

```sh
npm run mac:build      # produces macos/build/FlavorPress.app
npm run mac:run        # build + open
npm run mac:dmg        # build + package macos/build/FlavorPress-v<version>-arm64.dmg for release
```

What `build.sh` does:

1. Downloads Node `v22.11.0` arm64 into `macos/.cache/` (cached after first run).
2. Runs `npm run build` to produce `.next/standalone/` (requires `output: 'standalone'` in `next.config.ts`).
3. Copies the standalone bundle, `.next/static/`, and `public/` into `Contents/Resources/server/`.
4. Copies the cached Node binary to `Contents/Resources/node`.
5. Compiles `Sources/FlavorPressApp.swift` directly with `swiftc -parse-as-library` into `Contents/MacOS/FlavorPress`.
6. Ad-hoc signs the bundle.

Resulting `.app` is ~160MB. Apple Silicon only (arm64). Intel users should use the `npm run dev` path.

The build is ad-hoc signed with `codesign --sign -`; that's enough for local launch but Gatekeeper will warn the first time. Right-click → Open once, then it's trusted.

## Where state lives

- **Database**: `~/Library/Application Support/FlavorPress/flavorpress.db` (libSQL file URL set via `LIBSQL_URL` env when Swift spawns Node).
- **Server logs**: `~/Library/Logs/FlavorPress/server.log` (combined stdout + stderr from the Node child).
- **Settings (Anthropic API key, draft model, inbound secret)**: stored inside the DB above, edited at `/settings` in the running app.

The FlavorPress menu has a "Reveal Data Folder" item that opens Application Support directly.

## First-run flow

1. User double-clicks `FlavorPress.app`.
2. Swift launcher boots Node + Next; WebView opens on `http://127.0.0.1:<random>`.
3. App lands on `/` with no key configured. User opens **FlavorPress → Open Settings** (⌘,) and pastes their Anthropic API key.
4. Drafting works.

## Pointing at an external server (devs)

Override the embedded server with a URL set in `UserDefaults`:

```sh
defaults write com.flavorpress.desktop FlavorPressURL "http://localhost:3000"
```

When set, the app skips spawning Node and points the WebView at that URL — useful when iterating with `npm run dev`. Reset:

```sh
defaults delete com.flavorpress.desktop FlavorPressURL
```

## Files

- `Sources/FlavorPressApp.swift` — full app: SwiftUI scene, `WKWebView` wrapper, app delegate, embedded Node supervisor (`EmbeddedServer`), launch-at-login toggle.
- `Resources/Info.plist` — bundle metadata + ATS exception for `localhost`.
- `build.sh` — Node fetch + Next build + Swift compile + bundle assembly + ad-hoc sign.

## Why this exists

User asked. AGENTS.md scope test rated a desktop wrapper DEFER; Lucas explicitly overrode. Treat any feature creep on this surface (menu bar widget, native draft composer, push notifications, share extension) as a fresh scope test, not an extension of "we already have a mac app."
