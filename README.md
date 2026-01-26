# HM64 Entrance Rando Map

Live entrance‑randomizer flowchart for Shipwright → Sail → WebSocket.

This site connects to the local Sail WebSocket bridge and renders entrance connections as a flowchart. It also listens for live transition events so you can watch the path you’re currently taking.

## How it works

Shipwright emits:
- `seed_info` (entrance rando + decoupled info)
- `entrance_map` (known entrance connections)
- `transition` (scene transition events)

Sail receives those packets and exposes them locally at:
- WebSocket: `ws://127.0.0.1:43385/ws`
- HTTP state snapshot: `http://127.0.0.1:43385/state`

The page handshakes over WebSocket and then starts receiving live updates.

## Usage

1. Run Shipwright and enable Sail in the Network menu.
2. Run the Sail server (Deno) with networking permission:
   ```bash
   deno run --allow-net Sail.ts
   ```
3. Open the GitHub Pages site (or `index.html` locally).
4. Click **Connect** to start live updates.
   - The page sends a handshake and begins streaming.
   - Use **Load /state** if you want a one‑off snapshot.

## Controls

- **Drag** to pan
- **Scroll** to zoom
- **Reset View** returns to the default framing

## Decoupled entrances

If the seed uses decoupled entrances, edges are drawn with **one‑way arrows**.  
If not, they are rendered **two‑way**.

## Notes

- Only **discovered** entrances are included (matching the in‑game entrance tracker).
- The map is intentionally static HTML/JS to keep setup easy.

## Deploying on GitHub Pages

1. Push this repo to GitHub.
2. Repo → **Settings → Pages**.
3. Source: `Deploy from a branch` → `main` → `/root`.
4. Save and use the URL GitHub provides.

## Troubleshooting

- If **Connect** doesn’t work, confirm Sail is running and the port matches `43385`.
- If the map is empty, make sure the seed uses entrance randomizer and you’ve discovered at least one entrance.

