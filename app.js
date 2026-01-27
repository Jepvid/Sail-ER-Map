const wsStatus = document.getElementById("wsStatus");
const seedStatus = document.getElementById("seedStatus");
const modeStatus = document.getElementById("modeStatus");
const wsUrlInput = document.getElementById("wsUrl");
const connectBtn = document.getElementById("connectBtn");
const disconnectBtn = document.getElementById("disconnectBtn");
const loadStateBtn = document.getElementById("loadStateBtn");
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

const state = {
  decoupled: false,
  viewBox: { x: 0, y: 0, w: 1200, h: 800 },
  isPanning: false,
  panStart: { x: 0, y: 0, vx: 0, vy: 0 },
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
  });

  socket.addEventListener("close", () => {
    setStatus("Disconnected", "pill");
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
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
  const groupIds = Array.from(
    new Set(groupConnections.flatMap((c) => [c.fromGroup, c.toGroup])),
  );
  const adjacency = buildAdjacency(groupConnections);
  const clusters = findClusters(groupIds, adjacency);
  const positions = layoutClusters(clusters, adjacency, groupConnections, 1200, 800);

  groupConnections.forEach((c) => {
    const from = positions.get(c.fromGroup);
    const to = positions.get(c.toGroup);
    if (!from || !to) return;

    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2 - 40;

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "edge");
    path.setAttribute(
      "d",
      `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`,
    );

    if (state.decoupled) {
      path.setAttribute("marker-end", "url(#arrow)");
    } else {
      path.setAttribute("marker-end", "url(#arrow)");
      path.setAttribute("marker-start", "url(#arrow)");
    }

    edgesLayer.appendChild(path);

    const labelText = formatGroupEdgeLabel(c);
    if (labelText) {
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("class", "node-label");
      label.setAttribute("x", midX + 8);
      label.setAttribute("y", midY - 6);
      label.textContent = labelText;
      nodesLayer.appendChild(label);
    }
  });

  groupIds.forEach((id) => {
    const pos = positions.get(id);
    if (!pos) return;
    const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    circle.setAttribute("class", "node");
    circle.setAttribute("cx", pos.x);
    circle.setAttribute("cy", pos.y);
    circle.setAttribute("r", 16);

    const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
    label.setAttribute("class", "node-label");
    label.setAttribute("x", pos.x + 20);
    label.setAttribute("y", pos.y + 5);
    label.textContent = id;

    nodesLayer.appendChild(circle);
    nodesLayer.appendChild(label);
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
  const map = new Map();
  for (const c of connections) {
    if (c.fromGroupName && !map.has(c.fromEntrance)) {
      map.set(c.fromEntrance, c.fromGroupName);
    }
    if (c.toGroupName && !map.has(c.toEntrance)) {
      map.set(c.toEntrance, c.toGroupName);
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
    const edgeKey = `${c.fromEntrance}=>${c.toEntrance}`;
    if (seen.has(edgeKey)) continue;
    seen.add(edgeKey);
    edges.push({
      fromGroup,
      toGroup,
      entrances: [
        {
          fromEntrance: c.fromEntrance,
          toEntrance: c.toEntrance,
          fromName: c.fromName,
          toName: c.toName,
        },
      ],
    });
  }
  return edges;
}

function formatGroupEdgeLabel(edge) {
  if (!edge.entrances || edge.entrances.length === 0) return "";
  const first = edge.entrances[0];
  const fromLabel = first.fromName || hex(first.fromEntrance);
  const extra = edge.entrances.length - 1;
  return extra > 0 ? `${fromLabel} (+${extra})` : fromLabel;
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
  const padding = 80;
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
    layoutDirectedCluster(cluster, clusterEdges, cx, cy, cellW * 0.82, cellH * 0.82, positions);
  });

  return positions;
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
  state.viewBox = { x: 0, y: 0, w: 1200, h: 800 };
  updateViewBox();
});

document.getElementById("clearBtn").addEventListener("click", () => {
  entranceMap = null;
  nodesLayer.innerHTML = "";
  edgesLayer.innerHTML = "";
  emptyState.style.display = "grid";
});

connectBtn.addEventListener("click", connect);
disconnectBtn.addEventListener("click", disconnect);
loadStateBtn.addEventListener("click", loadState);

mapSvg.addEventListener("mousedown", startPan);
window.addEventListener("mousemove", movePan);
window.addEventListener("mouseup", endPan);
mapSvg.addEventListener("wheel", zoom, { passive: false });

updateViewBox();
renderCurrentScene();
