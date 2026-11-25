# The Riga Hunt

Scavenger-hunt web app for three teams. One static page (`docs/index.html`), hosted on GitHub Pages.
The answers are the decryption keys: the page contains no solutions, only ciphertext.

## Workflow

```bash
npm install          # once
# edit content/hunt.yaml (stations, answers, hints, teams, side quests, decoys)
npm run build        # → docs/index.html (public) + private/gamemaster.html (secret)
npm run verify       # plays through all teams, checks decoys and secret leaks
npm run serve        # http://localhost:8080 for testing in the desktop browser
npm test             # unit tests of the crypto module
```

- **`content/` and `private/` are secret** and listed in `.gitignore`. Back up `content/` separately.
- **Game masters' guide:** open `private/gamemaster.html` on the laptop and print it to PDF for your phones.
  It lists the routes and letters, and for every station how to solve it step by step, the hints and the solution.
  There are no skip codes: if a team is stuck, the game masters tell them the answer.
- **No start codes:** teams just pick their team in the app. The first riddle is readable by anyone (switching teams gains nothing);
  every later step is unlocked only by the previous answer.
- **Testing on a phone** works only via https (GitHub Pages). WebCrypto is not available on `http://<LAN-IP>`.
- **Changes during the game:** as long as `secret` in `hunt.yaml` stays the same, rebuild and redeploy at any time
  (e.g. to accept an extra answer variant). Players keep their progress. GitHub Pages caches for up to ~10 minutes.

## Content rules (summary)

- A maximum of 8 answer variants per question.
- No answers that can be guessed by hand: no bare numbers, nothing shorter than 4 characters (the build warns).
- Decoys must never equal a real answer (the build fails).
- `locationCheck.about` (optional, Markdown-light) is shown after the correct place name: a short "about this place" card.
- `eggs` are secret answers (not planted in the source) that show a special message on any step, e.g. the Mona jokes.
- Map riddles: `node scripts/make-map.js <lat> <lon> content/images/<name>.png [--size 1000] [--dx m] [--dy m]`
  draws an unlabelled map from OpenStreetMap data with an X on the target (rotate it via `transform.rotate`).
- Answers ignore a leading "the", so "The Old Mill" = "Old Mill". Riddle text supports `` `code` `` for ciphers.
- Images go in `content/images/` and are transformed at build time (`flip`, `crop`, `rotate`, `pixelate`, `grayscale`, `levels: [black, white]`, `negate`, `hue`),
  so the original never ends up in the page.

## Deployment (GitHub Pages)

1. Create a public repository and check with `git status` that `content/` and `private/` do **not** show up.
2. Run `npm run build && npm run verify`, then commit and push.
3. GitHub → Settings → Pages → Source: branch `main`, folder `/docs`.

## Structure

| Path | Contents |
|---|---|
| `src/crypto.js` | normalize, PBKDF2/AES-GCM, locks (used by the app and Node) |
| `src/main.js` | App UI (vanilla JS) |
| `src/style.css`, `src/fonts/` | Jugendstil theme, embedded fonts (Federo, Alegreya Sans, OFL) |
| `src/template.html` | HTML template including the planted decoys |
| `scripts/build.js` | Build (validation, images, encryption, bundling) |
| `scripts/verify.js` | Automatic play-through and leak check |
| `scripts/gamemaster.js` | Game masters' guide |
