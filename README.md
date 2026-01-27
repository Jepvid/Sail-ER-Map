# Sail-ER-Map

Entrance randomizer map UI for Shipwright.

This repo contains a no-dependency web app (plus a small Electron wrapper)
that connects to the local Sail bridge and renders discovered entrances as a
readable hub-and-spoke flowchart:

- Area hubs (e.g., Kokiri Forest)
- Entrance ports around each hub
- Direction-aware edges (decoupled vs coupled)
- Landing labels so you know where you arrive

## How it works

Shipwright emits:
- `seed_info` (entrance rando + decoupled info)
- `entrance_map` (known entrance connections + group/type metadata)
- `current_scene` (current area + spawn)

Sail receives those packets and exposes them locally at:
- WebSocket: `ws://127.0.0.1:43385/ws`
- HTTP state snapshot: `http://127.0.0.1:43385/state`

The page connects over WebSocket and then renders the current known state.

## Usage

1. Run Shipwright and enable Sail in the Network menu.
2. Run the Sail server (Deno) with networking permission:
   ```bash
   deno run --allow-net Sail.ts
   ```
3. Open the site (or `index.html` locally / via Electron).
4. Click **Connect** to start live updates.
   - Use **Load /state** if you want a one‑off snapshot.

## Controls

- **Drag** to pan
- **Scroll** to zoom
- **Reset View** returns to the default framing

## Decoupled entrances

If the seed uses decoupled entrances, edges are drawn with **one-way arrows**.
If not, they are rendered **two-way**.

Spawns, Warp Songs and Owls are always treated as one-way.

## Notes

- Only **discovered** entrances are included (matching the in‑game entrance tracker).
- The map is intentionally static HTML/JS to keep setup easy.

## Hosting

This repo is a static site. You can host it on any website by serving the
`index.html` file together with the affiliated files in this repo
(`app.js` and `styles.css`).

## Troubleshooting

- If **Connect** doesn’t work, confirm Sail is running and the port matches `43385`.
- If the map is empty, make sure the seed uses entrance randomizer and you’ve discovered at least one entrance.

## Run as a desktop app (Electron)

This avoids the browser mixed-content block from `https://` GitHub Pages.

1. Install deps:
   ```bash
   npm install
   ```
2. Start the desktop wrapper:
   ```bash
   npm start
   ```

This loads the same `index.html`, but from a desktop window so it can talk to:
- `ws://127.0.0.1:43385/ws`
- `http://127.0.0.1:43385/state`

## Desktop builds (no install)

The GitHub Action `Package Desktop App` builds platform artifacts:

- Linux: `.AppImage`
- macOS: `.dmg`
- Windows: `.zip`

All of these are intended to be "download and run" builds.

Sail stays separate and must be running at:

- `ws://127.0.0.1:43385/ws`
- `http://127.0.0.1:43385/state`
