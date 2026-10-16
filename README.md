# Christ's Church of Starke – sermon podcast

This builds the podcast feed that Apple Podcasts and Spotify read. Nobody has to touch it week to week.

**How it works:** twice a day it reads the church's sermon archive sheet and the Weekly Sermons page on ccofstarke.com, finds any new MP3, and publishes an updated `feed.xml`. A new link on the Weekly Sermons page becomes a new podcast episode within about 12 hours.

The audio stays where it already is (sermons.ccofstarke.com). This only publishes the list.

## One-time setup

1. In `config.json`, fill in `ownerEmail` (an inbox someone at the church checks; Spotify sends a code there) and confirm `feedUrl` and `image`.
2. Upload the cover art as `cover.jpg` (square, 3000×3000).
3. Settings → Pages → Source: **GitHub Actions**.
4. Actions tab → "Update podcast feed" → Run workflow.

## Fixing things

All fixes go in `overrides.json`:

- **Wrong title or speaker:** add it under `episodes`, e.g. `"101126am": { "title": "Be Reconciled" }`
- **Hide an episode:** add its file name (without `.mp3`) to `skip`
- **Add a recording that's on neither list:** add it to `extra`

`data/report.txt` lists archive entries with no audio file.

## Archive release

`drip` in `config.json` releases the back catalog two years at a time, one step per month, so the first month's downloads stay inside the audio storage's free allowance. Set `"enabled": false` to publish everything at once.
