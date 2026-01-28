const wsStatus = document.getElementById("wsStatus");
const seedStatus = document.getElementById("seedStatus");
const modeStatus = document.getElementById("modeStatus");
const wsUrlInput = document.getElementById("wsUrl");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const loadStateBtn = document.getElementById("loadStateBtn");
const debugPortsBtn = document.getElementById("debugPortsBtn");
const locateBtn = document.getElementById("locateBtn");
const currentScenePill = document.getElementById("currentScenePill");
const emptyState = document.getElementById("emptyState");

const mapSvg = document.getElementById("mapSvg");
const nodesLayer = document.getElementById("nodes");
const edgesLayer = document.getElementById("edges");

let socket = null;
let seedInfo = null;
let entranceMap = null;
let transitions = [];
let currentScene = null;
let pollTimer = null;

const CANVAS_SIZE = 10000;
const LOCATE_VIEW_SIZE = 500;
const SPAWN_GROUP = "Spawns/Warp Songs/Owls";
const SPAWN_HUB_RADIUS = 50;

const state = {
  decoupled: false,
  viewBox: { x: 0, y: 0, w: CANVAS_SIZE, h: CANVAS_SIZE },
  isPanning: false,
  panStart: { x: 0, y: 0, vx: 0, vy: 0 },
  lastCanvas: { w: CANVAS_SIZE, h: CANVAS_SIZE },
  showPorts: false,
  currentGroupId: null,
  lastPositions: null,
};

function setStatus(text, cls = "pill") {
  wsStatus.textContent = text;
  wsStatus.className = cls;
}

function updateSeedStatus() {
  if (!seedInfo) {
    seedStatus.textContent = "Seed: unknown";
    modeStatus.textContent = "Entrances: —";
    return;
  }

  seedStatus.textContent = seedInfo.entranceRando ? "Seed: entrance rando" : "Seed: vanilla";
  state.decoupled = !!seedInfo.decoupledEntrances;
  modeStatus.textContent = state.decoupled ? "Entrances: decoupled" : "Entrances: coupled";
}

function connect() {
  if (socket) {
    socket.close();
  }

  socket = new WebSocket(wsUrlInput.value);

  socket.addEventListener("open", () => {
    setStatus("Connected", "pill pill-accent");
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
    if (pollTimer) clearInterval(pollTimer);
    // Fallback: poll state so the map stays live even if WS misses a packet.
    pollTimer = setInterval(loadState, 3000);
  });

  socket.addEventListener("close", () => {
    setStatus("Disconnected", "pill");
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  });

  socket.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    const payload = JSON.parse(event.data);
    handlePayload(payload);
  });
}

function disconnect() {
  if (socket) {
    socket.close();
    socket = null;
  }
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function loadState() {
  const url = wsUrlInput.value.replace("ws://", "http://").replace("/ws", "/state");
  fetch(url)
    .then((res) => res.json())
    .then((data) => {
      if (data.seedInfo) seedInfo = data.seedInfo;
      if (data.entranceMap) entranceMap = data.entranceMap;
      if (data.currentScene) currentScene = data.currentScene;
      if (Array.isArray(data.transitions)) transitions = data.transitions;
      updateSeedStatus();
      render();
      renderCurrentScene();
    })
    .catch(() => {});
}

function handlePayload(payload) {
  switch (payload.type) {
    case "seed_info":
      seedInfo = payload;
      updateSeedStatus();
      return;
    case "entrance_map":
      entranceMap = payload;
      render();
      return;
    case "current_scene":
      currentScene = payload;
      renderCurrentScene();
      // Scene changes are a good signal that the entrance map may have updated.
      loadState();
      return;
    case "transition":
      transitions.push(payload);
      return;
    case "transition_history":
      transitions = payload.transitions || [];
      return;
    default:
      return;
  }
}

function renderCurrentScene() {
  if (!currentScene) {
    currentScenePill.textContent = "Current: —";
    return;
  }
  const label = currentScene.sceneName || hex(currentScene.sceneNum);
  const spawn = currentScene.spawn ?? "?";
  currentScenePill.textContent = `Current: ${label} (spawn ${spawn})`;
}

function render() {
  nodesLayer.innerHTML = "";
  edgesLayer.innerHTML = "";

  if (!entranceMap || !entranceMap.connections || entranceMap.connections.length === 0) {
    emptyState.style.display = "grid";
    return;
  }

  emptyState.style.display = "none";

  const connections = entranceMap.connections.slice(0, 400);
  const groupByEntrance = buildEntranceGroupMap(connections);
  const groupConnections = buildGroupConnections(connections, groupByEntrance);
  const spawnHubIds = new Set();
  for (const edge of groupConnections) {
    if (edge.fromIsSpawn) spawnHubIds.add(edge.fromGroup);
  }
  const groupIds = Array.from(
    new Set(groupConnections.flatMap((c) => [c.fromGroup, c.toGroup])),
  );
  const currentGroupId = resolveCurrentGroupId(currentScene, connections, groupByEntrance);
  const adjacency = buildAdjacency(groupConnections);
  const clusters = findClusters(groupIds, adjacency);
  const canvasSize = getCanvasSize(groupIds.length, groupConnections.length);
  const positions = layoutClusters(clusters, adjacency, groupConnections, canvasSize.w, canvasSize.h);
  state.currentGroupId = currentGroupId;
  state.lastPositions = positions;
  compactPositions(groupIds, groupConnections, positions);
  const hubRadius = 75;
  resolveCollisions(groupIds, groupConnections, positions, hubRadius);
  const hubs = groupIds.map((id) => positions.get(id)).filter(Boolean);
  const portRadius = 7.5;
  const outRadius = hubRadius + 26;
  const inRadius = state.decoupled ? hubRadius + 18 : hubRadius + 26;
  const outPorts = computePorts(groupConnections, positions, outRadius, "out", hubs, hubRadius);
  const inPorts = computePorts(groupConnections, positions, inRadius, "in", hubs, hubRadius);
  ensureCanvasSize(canvasSize);

  // Keep labels readable by avoiding hubs and other labels.
  const occupied = new Set();
  const occCell = 80;
  const occKey = (x, y) => `${Math.round(x / occCell)}:${Math.round(y / occCell)}`;
  const markOccupied = (x, y, pad = 0) => {
    const r = Math.max(20, pad);
    const minX = x - r;
    const maxX = x + r;
    const minY = y - r;
    const maxY = y + r;
    for (let xx = minX; xx <= maxX; xx += occCell / 2) {
      for (let yy = minY; yy <= maxY; yy += occCell / 2) {
        occupied.add(occKey(xx, yy));
      }
    }
  };
  const isFree = (x, y, pad = 0) => {
    const r = Math.max(16, pad);
    const minX = x - r;
    const maxX = x + r;
    const minY = y - r;
    const maxY = y + r;
    for (let xx = minX; xx <= maxX; xx += occCell / 2) {
      for (let yy = minY; yy <= maxY; yy += occCell / 2) {
        if (occupied.has(occKey(xx, yy))) return false;
      }
    }
    return true;
  };

  const placeLabel = (baseX, baseY, text, cls, angle) => {
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const nx = -uy;
    const ny = ux;
    const approxW = Math.min(420, text.length * 7 + 18);
    const approxH = 18;
    const pad = Math.max(44, approxW * 0.6);
    const farFromHubs = (x, y) => {
      const minDist = hubRadius + 70;
      for (const h of hubs) {
        const dx = x - h.x;
        const dy = y - h.y;
        if (Math.hypot(dx, dy) < minDist) return false;
      }
      return true;
    };
    const offsets = [1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6];
    for (const k of offsets) {
      const ox = nx * (k * 30) + ux * 16;
      const oy = ny * (k * 30) + uy * 16;
      const x = baseX + ox;
      const y = baseY + oy;
      if (!farFromHubs(x, y)) continue;
      if (!isFree(x, y, pad)) continue;
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("class", cls);
      label.setAttribute("x", x);
      label.setAttribute("y", y);
      label.textContent = text;
      nodesLayer.appendChild(label);
      markOccupied(x, y, pad);
      return;
    }
    // Fallback: place it even if crowded.
    const fx = baseX + nx * 24 + ux * 10;
    const fy = baseY + ny * 24 + uy * 10;
    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", cls);
    label.setAttribute("x", fx);
    label.setAttribute("y", fy);
    label.textContent = text;
    nodesLayer.appendChild(label);
    markOccupied(fx, fy, pad);
  };

  // Draw hubs first so labels/ports appear above them.
  groupIds.forEach((id) => {
    const pos = positions.get(id);
    if (!pos) return;
    const isSpawnHub = spawnHubIds.has(id);
    const nodeRadius = isSpawnHub ? SPAWN_HUB_RADIUS : hubRadius;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute(
      "class",
      id === currentGroupId
        ? isSpawnHub
          ? "hub-node hub-node-current hub-node-spawn"
          : "hub-node hub-node-current"
        : isSpawnHub
          ? "hub-node hub-node-spawn"
          : "hub-node",
    );
    circle.setAttribute("cx", pos.x);
    circle.setAttribute("cy", pos.y);
    circle.setAttribute("r", nodeRadius);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "hub-label");
    label.setAttribute("x", pos.x);
    label.setAttribute("y", pos.y + 4);
    label.textContent = id;

    nodesLayer.appendChild(circle);
    nodesLayer.appendChild(label);
    markOccupied(pos.x, pos.y, nodeRadius + 46);
  });

  // Track port positions and render them only when debugging.
  const drawn = new Set();
  for (const port of [...outPorts.values(), ...inPorts.values()]) {
    const key = `${port.x.toFixed(2)}:${port.y.toFixed(2)}`;
    if (drawn.has(key)) continue;
    drawn.add(key);
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", "port-node");
    circle.setAttribute("cx", port.x);
    circle.setAttribute("cy", port.y);
    circle.setAttribute("r", portRadius);
    nodesLayer.appendChild(circle);
    markOccupied(port.x, port.y, 26);
  }

  groupConnections.forEach((c) => {
    const fromHub = positions.get(c.fromGroup);
    const toHub = positions.get(c.toGroup);
    if (!fromHub || !toHub) return;
    const from = outPorts.get(c.id) || fromHub;
    const to = inPorts.get(c.id) || toHub;
    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 - 28;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    const destX = to.x - ux * 10;
    const destY = to.y - uy * 10;
    const angle = Math.atan2(dy, dx);
    const labelOffset = hubRadius + 90;
    const fromDirX = from.x - fromHub.x;
    const fromDirY = from.y - fromHub.y;
    const fromDirLen = Math.hypot(fromDirX, fromDirY) || 1;
    const toDirX = to.x - toHub.x;
    const toDirY = to.y - toHub.y;
    const toDirLen = Math.hypot(toDirX, toDirY) || 1;
    const fromAngle = Math.atan2(fromDirY, fromDirX);
    const toAngle = Math.atan2(toDirY, toDirX);

    const fromLabelBase = {
      x: fromHub.x + (fromDirX / fromDirLen) * labelOffset,
      y: fromHub.y + (fromDirY / fromDirLen) * labelOffset,
    };
    const toLabelBase = {
      x: toHub.x + (toDirX / toDirLen) * labelOffset,
      y: toHub.y + (toDirY / toDirLen) * labelOffset,
    };

    // Curve edges away from hubs when a straight line would collide.
    let nearCount = 0;
    const collideThresh = hubRadius * 1.1;
    for (const h of hubs) {
      if (!h || h === fromHub || h === toHub) continue;
      const d = distancePointToSegment(h.x, h.y, from.x, from.y, to.x, to.y);
      if (d < collideThresh) nearCount++;
    }
    const edgeHash = Math.abs(hashString(c.id));
    const bendDir = edgeHash % 2 === 0 ? 1 : -1;
    const bendMag = 60 + nearCount * 90;
    const ctrlX = midX + nx * bendMag * bendDir;
    const ctrlY = midY + ny * bendMag * bendDir;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "edge");
    path.setAttribute(
      "d",
      `M ${from.x} ${from.y} Q ${ctrlX} ${ctrlY} ${to.x} ${to.y}`,
    );

    const oneWayGroup = c.fromGroupId === 0 || c.toGroupId === 0;
    if (state.decoupled || oneWayGroup) {
      path.setAttribute("marker-end", "url(#arrow)");
    } else {
      path.setAttribute("marker-end", "url(#arrow)");
      path.setAttribute("marker-start", "url(#arrow)");
    }

    edgesLayer.appendChild(path);

    const labelText = formatGroupEdgeLabel(c);
    if (labelText) {
      placeLabel(fromLabelBase.x, fromLabelBase.y, labelText, "port-label", fromAngle);
    }

    const destLabelText = formatDestinationLabel(c);
    if (destLabelText) {
      placeLabel(toLabelBase.x, toLabelBase.y, destLabelText, "dest-label", toAngle);
    }
  });

}

function hex(value) {
  if (value === null || value === undefined) return "—";
  return `0x${Number(value).toString(16).toUpperCase()}`;
}

function buildAdjacency(connections) {
  const adjacency = new Map();
  for (const c of connections) {
    const from = c.fromEntrance ?? c.fromGroup;
    const to = c.toEntrance ?? c.toGroup;
    if (from === undefined || to === undefined) continue;
    if (!adjacency.has(from)) adjacency.set(from, new Set());
    if (!adjacency.has(to)) adjacency.set(to, new Set());
    adjacency.get(from).add(to);
    adjacency.get(to).add(from);
  }
  return adjacency;
}

function getCanvasSize(nodeCount, edgeCount) {
  return { w: CANVAS_SIZE, h: CANVAS_SIZE };
}

function ensureCanvasSize(target) {
  state.lastCanvas = target;
}

function buildEntranceNameMap(connections) {
  const map = new Map();
  for (const c of connections) {
    if (c.fromName && !map.has(c.fromEntrance)) {
      map.set(c.fromEntrance, c.fromName);
    }
    if (c.toName && !map.has(c.toEntrance)) {
      map.set(c.toEntrance, c.toName);
    }
  }
  return map;
}

function buildEntranceGroupMap(connections) {
  const resolution = buildGroupResolution(connections);
  const map = new Map();
  for (const c of connections) {
    if (!map.has(c.fromEntrance)) {
      map.set(c.fromEntrance, getFromGroupKey(c, resolution));
    }
    if (!map.has(c.toEntrance)) {
      map.set(c.toEntrance, getToGroupKey(c, resolution));
    }
  }
  return map;
}

function buildGroupConnections(connections, groupByEntrance) {
  const edges = [];
  const seen = new Set();
  for (const c of connections) {
    const fromGroup = groupByEntrance.get(c.fromEntrance) || c.fromGroupName || "Unknown";
    const toGroup = groupByEntrance.get(c.toEntrance) || c.toGroupName || "Unknown";
    if (!fromGroup || !toGroup) continue;
    const a = Number(c.fromEntrance);
    const b = Number(c.toEntrance);
    const fromLabel = (c.fromName || hex(c.fromEntrance)).toLowerCase();
    const toLabel = (c.toName || hex(c.toEntrance)).toLowerCase();
    const coupledKey =
      fromLabel <= toLabel
        ? `${fromGroup}|${fromLabel}<=>${toGroup}|${toLabel}`
        : `${toGroup}|${toLabel}<=>${fromGroup}|${fromLabel}`;
    const oneWay =
      state.decoupled ||
      c.fromTypeName === "One Way" ||
      c.toTypeName === "One Way" ||
      c.fromGroupName === SPAWN_GROUP ||
      c.toGroupName === SPAWN_GROUP;
    const edgeKey = oneWay ? `${a}=>${b}` : coupledKey;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);
    edges.push({
      id: edgeKey,
      fromGroup,
      toGroup,
      fromIsSpawn: c.fromGroupName === SPAWN_GROUP,
      fromEntrance: c.fromEntrance,
      toEntrance: c.toEntrance,
      fromGroupId: c.fromGroupId,
      toGroupId: c.toGroupId,
      entrances: [
        {
          fromEntrance: c.fromEntrance,
          toEntrance: c.toEntrance,
          fromName: c.fromName,
          toName: c.toName,
          spawn: c.spawn,
        },
      ],
    });
  }
  return edges;
}

function resolveCurrentGroupId(currentScenePacket, connections, groupByEntrance) {
  if (!currentScenePacket || !currentScenePacket.sceneName) return null;
  const name = currentScenePacket.sceneName;
  // If the scene name already matches a group hub, use it directly.
  if (name && typeof name === "string") {
    for (const c of connections) {
      if (c.fromGroupName === name) return c.fromGroupName;
      if (c.toGroupName === name) return c.toGroupName;
    }
  }
  // Otherwise, try to resolve via an entrance name.
  for (const c of connections) {
    if (c.fromName === name) {
      return groupByEntrance.get(c.fromEntrance) || c.fromGroupName || null;
    }
    if (c.toName === name) {
      return groupByEntrance.get(c.toEntrance) || c.toGroupName || null;
    }
  }
  return null;
}

function getFromGroupKey(c, resolution) {
  const name = c.fromName || "Unknown";
  if (c.fromGroupName !== SPAWN_GROUP) return c.fromGroupName || "Unknown";
  if (name.toLowerCase().includes("owl")) {
    return resolveAreaFromName(name, c.fromScene, resolution) || name;
  }
  return name;
}

function getToGroupKey(c, resolution) {
  const name = c.toName || "Unknown";
  if (c.toGroupName !== SPAWN_GROUP) return c.toGroupName || "Unknown";
  return resolveAreaFromName(name, c.toScene, resolution) || name;
}

function buildGroupResolution(connections) {
  const groupNames = new Set();
  const sceneToGroup = new Map();
  for (const c of connections) {
    if (c.fromGroupName && c.fromGroupName !== SPAWN_GROUP) {
      groupNames.add(c.fromGroupName);
      if (Number.isFinite(c.fromScene) && c.fromScene >= 0 && !sceneToGroup.has(c.fromScene)) {
        sceneToGroup.set(c.fromScene, c.fromGroupName);
      }
    }
    if (c.toGroupName && c.toGroupName !== SPAWN_GROUP) {
      groupNames.add(c.toGroupName);
      if (Number.isFinite(c.toScene) && c.toScene >= 0 && !sceneToGroup.has(c.toScene)) {
        sceneToGroup.set(c.toScene, c.toGroupName);
      }
    }
  }
  return { groupNames: Array.from(groupNames), sceneToGroup };
}

function resolveAreaFromName(name, sceneId, resolution) {
  if (Number.isFinite(sceneId) && sceneId >= 0) {
    const byScene = resolution.sceneToGroup.get(sceneId);
    if (byScene) return byScene;
  }

  const cleaned = name
    .replace(/warp\s*pad/gi, "")
    .replace(/owl\s*flight/gi, "")
    .replace(/spawn/gi, "")
    .trim();
  if (!cleaned) return null;

  const abbreviationMap = {
    dmc: "Death Mountain Crater",
    dmt: "Death Mountain Trail",
    lh: "Lake Hylia",
    llr: "Lon Lon Ranch",
    gv: "Gerudo Valley",
    gc: "Goron City",
    sfm: "Sacred Forest Meadow",
    zf: "Zora's Fountain",
    zd: "Zora's Domain",
    kak: "Kakariko Village",
    hf: "Hyrule Field",
    dc: "Desert Colossus",
  };

  const abbrevKey = cleaned.toLowerCase().replace(/[^a-z]/g, "");
  if (abbreviationMap[abbrevKey]) {
    const mapped = findGroupByName(abbreviationMap[abbrevKey], resolution.groupNames);
    if (mapped) return mapped;
  }

  return findGroupByName(cleaned, resolution.groupNames);
}

function findGroupByName(name, groupNames) {
  const target = normalizeName(name);
  if (!target) return null;
  let best = null;
  for (const group of groupNames) {
    const normalized = normalizeName(group);
    if (normalized === target) return group;
    if (normalized.includes(target) || target.includes(normalized)) {
      best = best || group;
    }
  }
  return best;
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatGroupEdgeLabel(edge) {
  if (!edge.entrances || edge.entrances.length === 0) return "";
  const first = edge.entrances[0];
  const fromLabel = first.fromName || hex(first.fromEntrance);
  const extra = edge.entrances.length - 1;
  return extra > 0 ? `${fromLabel} (+${extra})` : fromLabel;
}

function formatDestinationLabel(edge) {
  if (!edge.entrances || edge.entrances.length === 0) return "";
  const first = edge.entrances[0];
  const toLabel = first.toName || hex(first.toEntrance);
  if (first.spawn === undefined || first.spawn === null || first.spawn < 0) {
    return toLabel;
  }
  return `${toLabel} (spawn ${first.spawn})`;
}

function computePorts(edges, positions, radius, mode, hubs, hubRadius) {
  const ports = new Map();
  const byGroup = new Map();

  for (const e of edges) {
    const key = mode === "in" ? e.toGroup : e.fromGroup;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(e);
  }

  for (const [group, list] of byGroup.entries()) {
    const origin = positions.get(group);
    if (!origin) continue;
    // Build one anchor per entrance entry on this hub.
    const entryMap = new Map();
    for (const e of list) {
      const keyBase = mode === "in" ? e.toEntrance : e.fromEntrance;
      const key = state.decoupled ? `${keyBase}` : `${keyBase}:${mode}`;
      if (!entryMap.has(key)) {
        entryMap.set(key, { edges: [], others: [] });
      }
      entryMap.get(key).edges.push(e);
      const otherKey = mode === "in" ? e.fromGroup : e.toGroup;
      const other = positions.get(otherKey);
      if (other) entryMap.get(key).others.push(other);
    }

    const entries = Array.from(entryMap.entries())
      .map(([key, info]) => {
        if (info.others.length === 0) return null;
        const avg = info.others.reduce(
          (acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }),
          { x: 0, y: 0 },
        );
        const otherAvg = { x: avg.x / info.others.length, y: avg.y / info.others.length };
        const angle = Math.atan2(otherAvg.y - origin.y, otherAvg.x - origin.x);
        return { key, edges: info.edges, other: otherAvg, angle };
      })
      .filter(Boolean)
      .sort((a, b) => a.angle - b.angle);

    const count = entries.length;
    if (count === 0) continue;

    // Dynamic minimum separation: allow tighter spacing for dense hubs,
    // but never let anchors overlap.
    const minSep = Math.max(Math.PI / 18, Math.min(Math.PI / 4, (Math.PI * 1.35) / count));
    const angles = distributeAngles(entries, minSep);

    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const a = angles[i];
      const x = origin.x + Math.cos(a) * radius;
      const y = origin.y + Math.sin(a) * radius;
      for (const e of entry.edges) {
        ports.set(e.id, { x, y });
      }
    }
  }

  return ports;
}

function distributeAngles(entries, minSep) {
  if (entries.length <= 1) return entries.map((e) => e.angle);
  const twoPi = Math.PI * 2;
  const normalized = entries.map((entry, index) => {
    let a = entry.angle % twoPi;
    if (a < 0) a += twoPi;
    return { index, angle: a };
  });
  normalized.sort((a, b) => a.angle - b.angle);

  let cut = 0;
  let maxGap = -Infinity;
  for (let i = 0; i < normalized.length; i++) {
    const current = normalized[i].angle;
    const next = normalized[(i + 1) % normalized.length].angle + (i + 1 === normalized.length ? twoPi : 0);
    const gap = next - current;
    if (gap > maxGap) {
      maxGap = gap;
      cut = (i + 1) % normalized.length;
    }
  }

  const ordered = [];
  for (let i = 0; i < normalized.length; i++) {
    ordered.push(normalized[(cut + i) % normalized.length]);
  }

  let offset = 0;
  let prev = ordered[0].angle;
  const unwrapped = ordered.map((item, idx) => {
    if (idx > 0 && item.angle + offset < prev) {
      offset += twoPi;
    }
    const base = item.angle + offset;
    prev = base;
    return { index: item.index, angle: base };
  });

  for (let i = 1; i < unwrapped.length; i++) {
    if (unwrapped[i].angle - unwrapped[i - 1].angle < minSep) {
      unwrapped[i].angle = unwrapped[i - 1].angle + minSep;
    }
  }
  for (let i = unwrapped.length - 2; i >= 0; i--) {
    if (unwrapped[i + 1].angle - unwrapped[i].angle < minSep) {
      unwrapped[i].angle = unwrapped[i + 1].angle - minSep;
    }
  }

  const result = new Array(entries.length);
  for (const item of unwrapped) {
    let a = item.angle % twoPi;
    if (a < 0) a += twoPi;
    result[item.index] = a;
  }
  return result;
}

function distancePointToSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const apx = px - ax;
  const apy = py - ay;
  const ab2 = abx * abx + aby * aby;
  if (ab2 <= 1e-6) return Math.hypot(px - ax, py - ay);
  let t = (apx * abx + apy * aby) / ab2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  return Math.hypot(px - cx, py - cy);
}

function hashString(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

function findClusters(ids, adjacency) {
  const visited = new Set();
  const clusters = [];
  for (const id of ids) {
    if (visited.has(id)) continue;
    const cluster = [];
    const stack = [id];
    visited.add(id);
    while (stack.length) {
      const current = stack.pop();
      cluster.push(current);
      const neighbors = adjacency.get(current) || [];
      for (const n of neighbors) {
        if (!visited.has(n)) {
          visited.add(n);
          stack.push(n);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
}

function layoutClusters(clusters, adjacency, edges, width, height) {
  const positions = new Map();
  const padding = 140;
  const gridCols = Math.ceil(Math.sqrt(clusters.length));
  const cellW = (width - padding * 2) / Math.max(gridCols, 1);
  const cellH = (height - padding * 2) / Math.max(gridCols, 1);

  clusters.forEach((cluster, idx) => {
    const col = idx % gridCols;
    const row = Math.floor(idx / gridCols);
    const cx = padding + col * cellW + cellW / 2;
    const cy = padding + row * cellH + cellH / 2;
    const nodeSet = new Set(cluster);
    const clusterEdges = edges.filter((e) => nodeSet.has(e.fromGroup) && nodeSet.has(e.toGroup));
    layoutDirectedCluster(cluster, clusterEdges, cx, cy, cellW * 0.92, cellH * 0.92, positions);
  });

  return positions;
}

function compactPositions(nodeIds, edges, positions) {
  const vel = new Map();
  const neighbors = new Map();
  const degree = new Map();
  for (const id of nodeIds) {
    vel.set(id, { x: 0, y: 0 });
    neighbors.set(id, new Set());
    degree.set(id, 0);
  }

  for (const e of edges) {
    neighbors.get(e.fromGroup)?.add(e.toGroup);
    neighbors.get(e.toGroup)?.add(e.fromGroup);
    degree.set(e.fromGroup, (degree.get(e.fromGroup) || 0) + 1);
    degree.set(e.toGroup, (degree.get(e.toGroup) || 0) + 1);
  }

  // Keep this step lightweight; it runs often.
  const attraction = 0.022;
  const repulsion = 65000;
  const damping = 0.82;
  const ideal = 420;
  const baryPull = 0.045;
  const baseMinDist = 520;
  const densityFactor = 22;
  const maxMinDist = 1400;

  for (let iter = 0; iter < 60; iter++) {
    // Repulsion between all hubs.
    for (let i = 0; i < nodeIds.length; i++) {
      const a = nodeIds[i];
      const pa = positions.get(a);
      if (!pa) continue;
      for (let j = i + 1; j < nodeIds.length; j++) {
        const b = nodeIds[j];
        const pb = positions.get(b);
        if (!pb) continue;
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) d2 = 1;
        const d = Math.sqrt(d2);
        const force = repulsion / d2;
        dx /= d;
        dy /= d;
        const va = vel.get(a);
        const vb = vel.get(b);
        va.x -= dx * force;
        va.y -= dy * force;
        vb.x += dx * force;
        vb.y += dy * force;
      }
    }

    // Attraction along edges.
    for (const e of edges) {
      const a = e.fromGroup;
      const b = e.toGroup;
      const pa = positions.get(a);
      const pb = positions.get(b);
      if (!pa || !pb) continue;
      let dx = pb.x - pa.x;
      let dy = pb.y - pa.y;
      let d = Math.hypot(dx, dy) || 1;
      dx /= d;
      dy /= d;
      const stretch = d - ideal;
      const force = attraction * stretch;
      const va = vel.get(a);
      const vb = vel.get(b);
      va.x += dx * force;
      va.y += dy * force;
      vb.x -= dx * force;
      vb.y -= dy * force;
    }

    // Pull hubs toward the barycenter of their neighbors to reduce
    // roundabout lines when the graph grows.
    for (const id of nodeIds) {
      const p = positions.get(id);
      const ns = Array.from(neighbors.get(id) || []);
      if (!p || ns.length === 0) continue;
      let sx = 0;
      let sy = 0;
      let count = 0;
      for (const n of ns) {
        const pn = positions.get(n);
        if (!pn) continue;
        sx += pn.x;
        sy += pn.y;
        count++;
      }
      if (count === 0) continue;
      const bx = sx / count;
      const by = sy / count;
      const v = vel.get(id);
      v.x += (bx - p.x) * baryPull;
      v.y += (by - p.y) * baryPull;
    }

    // Integrate velocity.
    for (const id of nodeIds) {
      const p = positions.get(id);
      const v = vel.get(id);
      if (!p || !v) continue;
      v.x *= damping;
      v.y *= damping;
      p.x += v.x;
      p.y += v.y;
    }

    // Enforce a hard minimum spacing between hubs.
    for (let i = 0; i < nodeIds.length; i++) {
      const a = nodeIds[i];
      const pa = positions.get(a);
      if (!pa) continue;
      for (let j = i + 1; j < nodeIds.length; j++) {
        const b = nodeIds[j];
        const pb = positions.get(b);
        if (!pb) continue;
        let dx = pb.x - pa.x;
        let dy = pb.y - pa.y;
        let d = Math.hypot(dx, dy) || 1;
        const degA = degree.get(a) || 0;
        const degB = degree.get(b) || 0;
        const pairMin = Math.min(maxMinDist, baseMinDist + (degA + degB) * densityFactor);
        if (d >= pairMin) continue;
        dx /= d;
        dy /= d;
        const push = (pairMin - d) * 0.5;
        pa.x -= dx * push;
        pa.y -= dy * push;
        pb.x += dx * push;
        pb.y += dy * push;
      }
    }
  }
}

function resolveCollisions(nodeIds, edges, positions, hubRadius) {
  const minEdgeGap = hubRadius * 1.1;
  const maxIter = 18;

  for (let iter = 0; iter < maxIter; iter++) {
    let moved = false;
    for (let i = 0; i < nodeIds.length; i++) {
      const a = nodeIds[i];
      const pa = positions.get(a);
      if (!pa) continue;
      for (let j = i + 1; j < nodeIds.length; j++) {
        const b = nodeIds[j];
        const pb = positions.get(b);
        if (!pb) continue;
        const d = Math.hypot(pb.x - pa.x, pb.y - pa.y);
        if (d > hubRadius * 2.2) continue;

        // Count edges that pass too close to other hubs.
        let collisions = 0;
        for (const e of edges) {
          const from = positions.get(e.fromGroup);
          const to = positions.get(e.toGroup);
          if (!from || !to) continue;
          if (from === pa && to === pb) continue;
          if (from === pb && to === pa) continue;
          const da = distancePointToSegment(pa.x, pa.y, from.x, from.y, to.x, to.y);
          const db = distancePointToSegment(pb.x, pb.y, from.x, from.y, to.x, to.y);
          if (da < minEdgeGap || db < minEdgeGap) collisions++;
        }

        if (collisions === 0) continue;
        const angle = Math.atan2(pb.y - pa.y, pb.x - pa.x);
        const nx = -Math.sin(angle);
        const ny = Math.cos(angle);
        const push = Math.min(220, 30 + collisions * 18);
        pa.x -= nx * push;
        pa.y -= ny * push;
        pb.x += nx * push;
        pb.y += ny * push;
        moved = true;
      }
    }
    if (!moved) break;
  }
}

function layoutDirectedCluster(nodes, edges, cx, cy, spanX, spanY, positions) {
  const n = nodes.length;
  if (n === 1) {
    positions.set(nodes[0], { x: cx, y: cy });
    return;
  }

  const levels = buildDirectedLevels(nodes, edges);
  const undirectedAdj = buildAdjacency(edges);
  reduceCrossings(levels, undirectedAdj, 4);
  const levelCount = levels.length;
  const layerGap = spanX / Math.max(levelCount - 1, 1);

  levels.forEach((level, i) => {
    const x =
      levelCount === 1 ? cx : cx - spanX / 2 + layerGap * i;
    const nodeGap = spanY / Math.max(level.length, 1);
    level.forEach((id, j) => {
      const y = cy - spanY / 2 + nodeGap * (j + 0.5);
      positions.set(id, { x, y });
    });
  });
}

function buildDirectedLevels(nodes, edges) {
  const indegree = new Map();
  const outgoing = new Map();
  nodes.forEach((n) => {
    indegree.set(n, 0);
    outgoing.set(n, []);
  });

  for (const e of edges) {
    if (!indegree.has(e.fromGroup) || !indegree.has(e.toGroup)) continue;
    indegree.set(e.toGroup, (indegree.get(e.toGroup) || 0) + 1);
    outgoing.get(e.fromGroup).push(e.toGroup);
  }

  const layerByNode = new Map();
  const queue = [];
  for (const n of nodes) {
    if ((indegree.get(n) || 0) === 0) {
      queue.push(n);
      layerByNode.set(n, 0);
    }
  }

  while (queue.length) {
    const cur = queue.shift();
    const curLayer = layerByNode.get(cur) || 0;
    for (const next of outgoing.get(cur) || []) {
      const nextLayer = Math.max(layerByNode.get(next) || 0, curLayer + 1);
      layerByNode.set(next, nextLayer);
      indegree.set(next, (indegree.get(next) || 0) - 1);
      if ((indegree.get(next) || 0) <= 0) {
        queue.push(next);
      }
    }
  }

  // Handle cycles or disconnected nodes by relaxing edges a few times.
  nodes.forEach((n) => {
    if (!layerByNode.has(n)) layerByNode.set(n, 0);
  });
  for (let i = 0; i < 4; i++) {
    for (const e of edges) {
      const fromLayer = layerByNode.get(e.fromGroup) || 0;
      const toLayer = layerByNode.get(e.toGroup) || 0;
      if (toLayer <= fromLayer) {
        layerByNode.set(e.toGroup, fromLayer + 1);
      }
    }
  }

  const maxLayer = Math.max(0, ...Array.from(layerByNode.values()));
  const levels = Array.from({ length: maxLayer + 1 }, () => []);
  for (const n of nodes) {
    levels[layerByNode.get(n) || 0].push(n);
  }
  return levels;
}

function buildLevels(nodes, adjacency) {
  const degrees = new Map();
  nodes.forEach((id) => degrees.set(id, (adjacency.get(id) || []).size));
  let root = nodes[0];
  for (const id of nodes) {
    if ((degrees.get(id) || 0) > (degrees.get(root) || 0)) {
      root = id;
    }
  }

  const levels = [];
  const visited = new Set([root]);
  let queue = [root];
  while (queue.length) {
    levels.push(queue);
    const next = [];
    for (const id of queue) {
      const neighbors = adjacency.get(id) || [];
      for (const nId of neighbors) {
        if (!visited.has(nId)) {
          visited.add(nId);
          next.push(nId);
        }
      }
    }
    queue = next;
  }

  // Any disconnected stragglers in the cluster
  for (const id of nodes) {
    if (!visited.has(id)) {
      levels.push([id]);
    }
  }

  return levels;
}

function reduceCrossings(levels, adjacency, passes) {
  const position = new Map();
  levels.forEach((level, i) => {
    level.forEach((id, j) => position.set(id, { layer: i, order: j }));
  });

  for (let p = 0; p < passes; p++) {
    // Down sweep
    for (let i = 1; i < levels.length; i++) {
      levels[i].sort((a, b) => barycenter(a, i - 1) - barycenter(b, i - 1));
      levels[i].forEach((id, j) => position.set(id, { layer: i, order: j }));
    }
    // Up sweep
    for (let i = levels.length - 2; i >= 0; i--) {
      levels[i].sort((a, b) => barycenter(a, i + 1) - barycenter(b, i + 1));
      levels[i].forEach((id, j) => position.set(id, { layer: i, order: j }));
    }
  }

  function barycenter(id, targetLayer) {
    const neighbors = adjacency.get(id) || [];
    const orders = [];
    for (const nId of neighbors) {
      const pos = position.get(nId);
      if (pos && pos.layer === targetLayer) {
        orders.push(pos.order);
      }
    }
    if (orders.length === 0) return 0;
    return orders.reduce((a, b) => a + b, 0) / orders.length;
  }
}

function updateViewBox() {
  mapSvg.setAttribute(
    "viewBox",
    `${state.viewBox.x} ${state.viewBox.y} ${state.viewBox.w} ${state.viewBox.h}`,
  );
}

function locatePlayer() {
  if (!state.currentGroupId || !state.lastPositions) return;
  const pos = state.lastPositions.get(state.currentGroupId);
  if (!pos) return;
  const size = LOCATE_VIEW_SIZE;
  let x = pos.x - size / 2;
  let y = pos.y - size / 2;
  x = Math.max(0, Math.min(CANVAS_SIZE - size, x));
  y = Math.max(0, Math.min(CANVAS_SIZE - size, y));
  state.viewBox = { x, y, w: size, h: size };
  updateViewBox();
}

function startPan(event) {
  state.isPanning = true;
  state.panStart.x = event.clientX;
  state.panStart.y = event.clientY;
  state.panStart.vx = state.viewBox.x;
  state.panStart.vy = state.viewBox.y;
}

function movePan(event) {
  if (!state.isPanning) return;
  const dx = (event.clientX - state.panStart.x) * (state.viewBox.w / mapSvg.clientWidth);
  const dy = (event.clientY - state.panStart.y) * (state.viewBox.h / mapSvg.clientHeight);
  state.viewBox.x = state.panStart.vx - dx;
  state.viewBox.y = state.panStart.vy - dy;
  updateViewBox();
}

function endPan() {
  state.isPanning = false;
}

function zoom(event) {
  event.preventDefault();
  const scale = event.deltaY > 0 ? 1.08 : 0.92;
  const rect = mapSvg.getBoundingClientRect();
  const mx = ((event.clientX - rect.left) / rect.width) * state.viewBox.w + state.viewBox.x;
  const my = ((event.clientY - rect.top) / rect.height) * state.viewBox.h + state.viewBox.y;

  state.viewBox.w *= scale;
  state.viewBox.h *= scale;
  state.viewBox.x = mx - (mx - state.viewBox.x) * scale;
  state.viewBox.y = my - (my - state.viewBox.y) * scale;
  updateViewBox();
}

document.getElementById("resetBtn").addEventListener("click", () => {
  state.viewBox = { x: 0, y: 0, w: state.lastCanvas.w, h: state.lastCanvas.h };
  updateViewBox();
});

document.getElementById("clearBtn").addEventListener("click", () => {
  entranceMap = null;
  nodesLayer.innerHTML = "";
  edgesLayer.innerHTML = "";
  emptyState.style.display = "grid";
});

function setDebugPorts(enabled) {
  state.showPorts = enabled;
  document.body.classList.toggle("debug-ports", enabled);
  if (debugPortsBtn) {
    debugPortsBtn.textContent = enabled ? "Hide Anchors" : "Show Anchors";
  }
}

connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
loadStateBtn.addEventListener("click", loadState);
if (debugPortsBtn) {
  debugPortsBtn.addEventListener("click", () => setDebugPorts(!state.showPorts));
}
if (locateBtn) {
  locateBtn.addEventListener("click", locatePlayer);
}

mapSvg.addEventListener("mousedown", startPan);
window.addEventListener("mousemove", movePan);
window.addEventListener("mouseup", endPan);
mapSvg.addEventListener("wheel", zoom, { passive: false });

updateViewBox();
renderCurrentScene();
setDebugPorts(false);
