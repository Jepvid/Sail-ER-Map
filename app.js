const els = {
  wsStatus: document.getElementById("wsStatus"),
  seedStatus: document.getElementById("seedStatus"),
  modeStatus: document.getElementById("modeStatus"),
  wsUrl: document.getElementById("wsUrl"),
  connectBtn: document.getElementById("connectBtn"),
  disconnectBtn: document.getElementById("disconnectBtn"),
  loadStateBtn: document.getElementById("loadStateBtn"),
  debugPortsBtn: document.getElementById("debugPortsBtn"),
  toggleLabelsBtn: document.getElementById("toggleLabelsBtn"),
  locateBtn: document.getElementById("locateBtn"),
  currentScenePill: document.getElementById("currentScenePill"),
  emptyState: document.getElementById("emptyState"),
  debugOutput: document.getElementById("debugOutput"),
  clearDebugBtn: document.getElementById("clearDebugBtn"),
  clickIndicator: document.getElementById("clickIndicator"),
  mapSvg: document.getElementById("mapSvg"),
  nodesLayer: document.getElementById("nodes"),
  edgesLayer: document.getElementById("edges"),
  resetBtn: document.getElementById("resetBtn"),
  clearBtn: document.getElementById("clearBtn"),
};

const CANVAS = 10000;
const DEBUG = true;

const state = {
  db: null,
  socket: null,
  pollTimer: null,
  seedInfo: null,
  entranceMap: null,
  currentScene: null,
  transitions: [],
  showLabels: false,
  showPorts: false,
  viewBox: { x: 0, y: 0, w: CANVAS, h: CANVAS },
  positions: new Map(),
  currentNodeKey: null,
};

const debugLog = (...args) => {
  if (!DEBUG) return;
  const msg = args
    .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
    .join(" ");
  console.log("[map]", msg);
  if (els.debugOutput) {
    const time = new Date().toLocaleTimeString();
    els.debugOutput.textContent += `[${time}] ${msg}\n`;
    els.debugOutput.scrollTop = els.debugOutput.scrollHeight;
  }
};

let clickTimer = null;
const showClick = (label) => {
  if (!els.clickIndicator) return;
  els.clickIndicator.textContent = `Click: ${label}`;
  els.clickIndicator.classList.add("is-visible");
  if (clickTimer) clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    els.clickIndicator.classList.remove("is-visible");
  }, 1200);
};

const bind = (el, eventName, handler, label) => {
  if (!el) {
    debugLog("bind missing", label || eventName);
    return;
  }
  el.addEventListener(eventName, handler);
};

const toNumber = (value) => {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const loadDatabase = async () => {
  try {
    const res = await fetch("data/database.json");
    if (!res.ok) {
      throw new Error(`database fetch ${res.status}`);
    }
    const data = await res.json();
    const setKeys = [
      "dungeonEntrances",
      "dungeonExitEntrances",
      "bossEntrances",
      "bossDoors",
      "grottoEntrances",
      "grottoExitEntrances",
      "warpPads",
      "owlFlights",
      "outsideInteriorEntrances",
    ];
    for (const key of setKeys) {
      if (Array.isArray(data[key])) {
        data[key] = new Set(data[key].map((v) => Number(v)));
      }
    }
    if (data.sceneNames) {
      const alias = {};
      for (const [sceneId, name] of Object.entries(data.sceneNames)) {
        const normalized = normalizeSceneName(name);
        const idNum = Number(sceneId);
        if (!Number.isFinite(idNum)) continue;
        if (alias[normalized] == null || idNum < alias[normalized]) {
          alias[normalized] = idNum;
        }
      }
      data.sceneAliases = alias;
    }
    const overworldScenes = new Set();
    const addFromIds = (ids, sourceMap) => {
      if (!Array.isArray(ids) || !sourceMap) return;
      for (const id of ids) {
        const scene = sourceMap[id];
        if (scene != null && Number.isFinite(Number(scene))) {
          overworldScenes.add(Number(scene));
        }
      }
    };
    addFromIds(data.dungeonEntrances, data.dungeonEntranceSourceScene || data.entranceSourceScene);
    addFromIds(data.grottoEntrances, data.entranceSourceScene);
    addFromIds(data.outsideInteriorEntrances, data.entranceSourceScene);
    addFromIds(data.warpPads, data.entranceSourceScene);
    addFromIds(data.owlFlights, data.entranceSourceScene);
    data.overworldScenes = overworldScenes;
    debugLog("sceneCategory check", {
      83: data.sceneCategory?.["83"],
      86: data.sceneCategory?.["86"],
    });
    return data;
  } catch (err) {
    debugLog("database load failed", String(err));
    return null;
  }
};

const isWarpSong = (meta) => {
  if (!meta) return false;
  if (meta.groupName !== "Spawns/Warp Songs/Owls") return false;
  const name = String(meta.name || meta.source || "").toLowerCase();
  if (name.includes("warp pad") || name.includes("owl")) return false;
  return ["minuet", "bolero", "serenade", "requiem", "nocturne", "prelude"].some((k) =>
    name.includes(k),
  );
};

const isSpawnEntrance = (meta) => {
  if (!meta) return false;
  if (meta.groupName !== "Spawns/Warp Songs/Owls") return false;
  const name = String(meta.name || meta.source || "").toLowerCase();
  if (name.includes("warp pad")) return false;
  if (name.includes("owl")) return false;
  if (name.includes("spawn")) return true;
  return isWarpSong(meta);
};

const isPlayerSpawn = (meta) => {
  if (!meta) return false;
  if (meta.groupName !== "Spawns/Warp Songs/Owls") return false;
  if (isWarpPad(meta.id, meta)) return false;
  const name = String(meta.name || meta.source || "").toLowerCase();
  return name.includes("spawn");
};

const isGrottoEntry = (entranceId) =>
  state.db?.grottoEntrances?.has(Number(entranceId)) ?? false;

const isGrottoExit = (entranceId) =>
  state.db?.grottoExitEntrances?.has(Number(entranceId)) ?? false;

const isGrottoType = (meta) => String(meta?.typeName || "").toLowerCase() === "grotto";

const isWarpPad = (entranceId, meta) => {
  if (state.db?.warpPads?.has(Number(entranceId))) return true;
  if (!meta) return false;
  if (meta.isWarpPad) return true;
  if (meta.groupName !== "Spawns/Warp Songs/Owls") return false;
  const name = String(meta.name || meta.source || "").toLowerCase();
  return name.includes("warp pad");
};

const getGrottoEntryIdFromExit = (entranceId) => {
  const id = Number(entranceId);
  if (!Number.isFinite(id)) return null;
  const entryId = id - 0x100;
  return entryId >= 0 ? entryId : null;
};

const isInteriorEntry = (entranceId) =>
  state.db?.outsideInteriorEntrances?.has(Number(entranceId)) ?? false;

const isBossEntrance = (entranceId) =>
  (state.db?.bossEntrances?.has(Number(entranceId)) ?? false) ||
  (state.db?.bossDoors?.has(Number(entranceId)) ?? false);

const resolveBossDoorParent = (entranceId) => {
  const id = Number(entranceId);
  if (!Number.isFinite(id)) return null;
  if (!state.db?.bossDoorToDungeonEntrance) return null;
  const parent = state.db.bossDoorToDungeonEntrance[id];
  if (Number.isFinite(parent)) return parent;
  const fallback = state.db.bossDoorToDungeonEntrance[String(id)];
  return Number.isFinite(fallback) ? fallback : null;
};

const getEntranceSourceScene = (entranceId) => {
  const id = Number(entranceId);
  if (!Number.isFinite(id)) return null;
  const source =
    state.db?.entranceSourceScene?.[id] ?? state.db?.dungeonEntranceSourceScene?.[id];
  if (source != null) return resolveSceneAlias(Number(source));
  const fallback = state.db?.entranceScene?.[id];
  if (fallback == null) return null;
  return resolveSceneAlias(Number(fallback));
};

const getExteriorSceneFromReverse = (meta) => {
  const reverseId = toNumber(meta?.reverseEntrance);
  if (reverseId == null) return null;
  const source = getEntranceSourceScene(reverseId);
  if (source != null) return source;
  const fallback = state.db?.entranceScene?.[reverseId];
  return fallback != null ? resolveSceneAlias(Number(fallback)) : null;
};

const getCanonicalScene = (meta, entranceId) => {
  if (meta?.scenes?.length) {
    const scenes = meta.scenes
      .map((scene) => toNumber(scene.scene))
      .filter((scene) => scene != null && scene >= 0);
    if (scenes.length) {
      const tag = String(meta?.metaTag || "").toLowerCase();
      if (tag.includes("outside ganon's castle")) {
        const match = scenes.find((sceneId) => {
          const name = state.db?.sceneNames?.[sceneId] || "";
          const normalized = normalizeSceneName(name).toLowerCase();
          return (
            normalized.includes("outside ganon's castle") ||
            normalized.includes("ganon's castle exterior")
          );
        });
        if (match != null) return match;
      }
      return Math.min(...scenes);
    }
  }
  const sceneNum = toNumber(meta?.sceneNum);
  if (sceneNum != null && sceneNum >= 0) {
    return resolveSceneAlias(sceneNum);
  }
  const dbScene = state.db?.entranceScene?.[Number(entranceId)];
  if (dbScene != null) return resolveSceneAlias(dbScene);
  const grottoScene = state.db?.grottoLoadScene?.[Number(entranceId)];
  if (grottoScene != null) return resolveSceneAlias(grottoScene);
  return null;
};

const getSpawnTargetNode = (entranceId, meta) => {
  if (!entranceId) return null;
  const typeName = String(meta?.typeName || "").toLowerCase();
  const isInteriorType = typeName === "interior" || typeName === "shop";
  if (isInteriorEntry(entranceId) || isInteriorType || isGrottoEntry(entranceId) || isGrottoType(meta)) {
    const sourceScene = getExteriorSceneFromReverse(meta);
    if (sourceScene != null) return `scene:${sourceScene}`;
    debugLog("spawn target missing reverse entrance scene", {
      entranceId,
      reverseEntrance: meta?.reverseEntrance,
    });
  }
  return null;
};

const getSceneLabel = (sceneNum) => {
  if (!Number.isFinite(sceneNum)) return "Unknown";
  let label = state.db?.sceneNames?.[sceneNum] || `Scene ${sceneNum}`;
  if (label.startsWith("SCENE_")) {
    label = label.slice("SCENE_".length);
  }
  label = label.replace(/_/g, " ").trim();
  label = normalizeSceneName(label);
  return label;
};

const normalizeSceneName = (value) => {
  let label = String(value || "");
  if (label.startsWith("SCENE_")) {
    label = label.slice("SCENE_".length);
  }
  label = label.replace(/_/g, " ").trim();
  label = label.replace(/\s+\((Child|Adult)\s*-\s*(Day|Night)\)/gi, "");
  label = label.replace(/\s+\((Day|Night)\)/gi, "");
  label = label.replace(/\s+\(Ruins\)/gi, "");
  if (/^back alley/i.test(label)) {
    label = "Market";
  }
  if (/outside ganon's castle/i.test(label) || /hyrule castle/i.test(label)) {
    label = "Hyrule Castle / OGC";
  }
  return label.trim();
};

const resolveSceneAlias = (sceneNum) => {
  if (!Number.isFinite(sceneNum)) return sceneNum;
  const name = state.db?.sceneNames?.[sceneNum];
  if (!name || !state.db?.sceneAliases) return sceneNum;
  const normalized = normalizeSceneName(name);
  return state.db.sceneAliases[normalized] ?? sceneNum;
};

const getSceneCategory = (sceneNum) => {
  if (state.db?.sceneCategory && state.db.sceneCategory[sceneNum]) {
    return state.db.sceneCategory[sceneNum];
  }
  return "overworld";
};

const getNodeKeyForEntrance = (entranceId, meta) => {
  if (isGrottoExit(entranceId)) {
    const entryId = getGrottoEntryIdFromExit(entranceId);
    if (entryId != null) return `grotto:${entryId}`;
  }
  if (isGrottoEntry(entranceId)) return `grotto:${entranceId}`;
  if (isGrottoType(meta)) return `grotto:${entranceId}`;
  if (isInteriorEntry(entranceId)) {
    const typeName = String(meta?.typeName || "").toLowerCase();
    if (typeName === "interior" || typeName === "shop") {
      const interiorScene = getEntranceSourceScene(toNumber(meta?.reverseEntrance));
      if (interiorScene != null) return `scene:${interiorScene}`;
    }
  }
  if (isWarpPad(entranceId, meta)) {
    const sceneNum = getEntranceSourceScene(entranceId) ?? getCanonicalScene(meta, entranceId);
    if (sceneNum != null) return `scene:${sceneNum}`;
  }
  if (isSpawnEntrance(meta)) return `spawn:${entranceId}`;
  const sceneNum = getCanonicalScene(meta, entranceId);
  if (sceneNum != null) return `scene:${sceneNum}`;
  return `entrance:${entranceId}`;
};

const parseNodeKey = (key) => {
  const [type, id] = key.split(":");
  return { type, id: id ? Number(id) : null };
};

const buildSideMeta = (entry, side) => ({
  id: toNumber(entry[`${side}Entrance`]),
  name: entry[`${side}Name`],
  source: entry[`${side}Source`],
  destination: entry[`${side}Destination`],
  groupName: entry[`${side}GroupName`],
  groupId: entry[`${side}GroupId`],
  typeName: entry[`${side}TypeName`],
  sceneNum: entry[`${side}Scene`],
  sceneName: entry[`${side}SceneName`],
  scenes: entry[`${side}Scenes`] || [],
  spawn: entry[`${side}Spawn`],
  room: entry[`${side}Room`],
  isOneWay: entry[`${side}IsOneWay`],
  oneExit: entry[`${side}OneExit`],
  reverseEntrance: entry[`${side}ReverseEntrance`],
  metaTag: entry[`${side}MetaTag`],
});

const buildMetaMap = (connections) => {
  const meta = new Map();
  const add = (entranceId, data, side) => {
    if (!Number.isFinite(entranceId) || !data) return;
    const nameValue = String(data[`${side}Name`] || data[`${side}Source`] || "");
    const isWarpPadName = nameValue.toLowerCase().includes("warp pad");
    if (!meta.has(entranceId)) {
      meta.set(entranceId, {
        id: entranceId,
        name: data[`${side}Name`],
        source: data[`${side}Source`],
        destination: data[`${side}Destination`],
        groupName: data[`${side}GroupName`],
        groupId: data[`${side}GroupId`],
        typeName: data[`${side}TypeName`],
        sceneNum: data[`${side}Scene`],
        sceneName: data[`${side}SceneName`],
        scenes: data[`${side}Scenes`] || [],
        spawn: data[`${side}Spawn`],
        room: data[`${side}Room`],
        isOneWay: data[`${side}IsOneWay`],
        oneExit: data[`${side}OneExit`],
        reverseEntrance: data[`${side}ReverseEntrance`],
        metaTag: data[`${side}MetaTag`],
        isWarpPad: isWarpPadName,
      });
    } else if (isWarpPadName) {
      const existing = meta.get(entranceId);
      existing.isWarpPad = true;
    }
  };
  for (const entry of connections) {
    add(toNumber(entry.fromEntrance), entry, "from");
    add(toNumber(entry.toEntrance), entry, "to");
  }
  return meta;
};

const buildGraph = (connections, metaMap) => {
  const nodes = new Map();
  const edges = [];
  const edgeKeys = new Set();
  const sceneTypeCounts = new Map();

  for (const meta of metaMap.values()) {
    const sceneNum = getCanonicalScene(meta, meta.id);
    if (sceneNum == null) continue;
    const key = `scene:${sceneNum}`;
    const bucket = sceneTypeCounts.get(key) || {};
    const typeName = (meta.typeName || "").toLowerCase();
    if (typeName) {
      bucket[typeName] = (bucket[typeName] || 0) + 1;
      sceneTypeCounts.set(key, bucket);
    }
  }

  const resolveSceneCategory = (sceneNum) => {
    if (
      state.db?.sceneCategory &&
      Object.prototype.hasOwnProperty.call(state.db.sceneCategory, String(sceneNum))
    ) {
      return state.db.sceneCategory[String(sceneNum)];
    }
    if (state.db?.overworldScenes?.has(sceneNum)) return "overworld";
    const counts = sceneTypeCounts.get(`scene:${sceneNum}`) || {};
    if (counts.overworld) return "overworld";
    if (counts.dungeon) return "dungeon";
    if (counts.interior || counts.shop) return "interior";
    if (counts.grotto) return "grotto";
    const base = getSceneCategory(sceneNum);
    return base || "overworld";
  };

  const ensureNode = (key, meta, entranceId) => {
    if (nodes.has(key)) return;
    const { type, id } = parseNodeKey(key);
    let label = "Unknown";
    let category = "overworld";
    if (type === "scene") {
      label = getSceneLabel(id);
      category = resolveSceneCategory(id);
    } else if (type === "grotto") {
      label = meta?.destination || meta?.name || `Grotto ${entranceId}`;
      category = "grotto";
    } else if (type === "interior") {
      label = meta?.destination || meta?.name || `Interior ${entranceId}`;
      category = "interior";
    } else if (type === "boss") {
      label = meta?.destination || meta?.name || `Boss ${entranceId}`;
      category = "boss";
    } else if (type === "spawn") {
      label = meta?.name || meta?.source || `Spawn ${entranceId}`;
      category = "spawn";
    } else {
      label = meta?.destination || meta?.name || `Entrance ${entranceId}`;
      category = meta?.typeName?.toLowerCase() || "overworld";
    }
    nodes.set(key, { key, label, category });
  };

  for (const entry of connections) {
    const fromMeta = buildSideMeta(entry, "from");
    const toMeta = buildSideMeta(entry, "to");
    const fromId = fromMeta.id;
    const toId = toMeta.id;
    const fromKey = getNodeKeyForEntrance(fromId, fromMeta);
    let toKey = getNodeKeyForEntrance(toId, toMeta);
    if (fromMeta && isPlayerSpawn(fromMeta)) {
      toKey = getSpawnTargetNode(toId, toMeta) || toKey;
    }
    if (!fromKey || !toKey || fromKey === toKey) continue;

    ensureNode(fromKey, fromMeta, fromId);
    ensureNode(toKey, toMeta, toId);

    const forwardOneWay = entry.toIsOneWay || entry.fromIsOneWay;
    const forwardKey = `${fromKey}->${toKey}`;
    if (!edgeKeys.has(forwardKey)) {
      edges.push({
        from: fromKey,
        to: toKey,
        label: entry.toName || entry.toDestination || entry.toSource || "",
        oneWay: forwardOneWay,
      });
      edgeKeys.add(forwardKey);
    }

    if (!forwardOneWay && !state.seedInfo?.decoupledEntrances) {
      const reverseKey = `${toKey}->${fromKey}`;
      if (!edgeKeys.has(reverseKey)) {
        edges.push({
          from: toKey,
          to: fromKey,
          label: entry.fromName || entry.fromDestination || entry.fromSource || "",
          oneWay: false,
        });
        edgeKeys.add(reverseKey);
      }
    }
  }

  return { nodes, edges };
};

const layoutNodes = (nodes) => {
  const keys = Array.from(nodes.keys());
  const positions = new Map();
  if (keys.length === 0) return positions;
  const radius = Math.max(1200, keys.length * 40);
  const center = CANVAS / 2;
  keys.forEach((key, idx) => {
    const angle = (idx / keys.length) * Math.PI * 2;
    positions.set(key, {
      x: center + Math.cos(angle) * radius,
      y: center + Math.sin(angle) * radius,
    });
  });
  return positions;
};

const clearMap = () => {
  if (els.nodesLayer) els.nodesLayer.innerHTML = "";
  if (els.edgesLayer) els.edgesLayer.innerHTML = "";
};

const svgEl = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);

const render = () => {
  clearMap();
  if (!state.entranceMap?.connections?.length) {
    if (els.emptyState) els.emptyState.style.display = "grid";
    debugLog("render skipped", "no data");
    return;
  }
  if (els.emptyState) els.emptyState.style.display = "none";

  const connections = state.entranceMap.connections;
  const metaMap = buildMetaMap(connections);
  const graph = buildGraph(connections, metaMap);
  state.positions = layoutNodes(graph.nodes);

  debugLog("render", "nodes", graph.nodes.size, "edges", graph.edges.length);

  for (const edge of graph.edges) {
    const fromPos = state.positions.get(edge.from);
    const toPos = state.positions.get(edge.to);
    if (!fromPos || !toPos) continue;

    const line = svgEl("line");
    line.setAttribute("x1", fromPos.x);
    line.setAttribute("y1", fromPos.y);
    line.setAttribute("x2", toPos.x);
    line.setAttribute("y2", toPos.y);
    line.setAttribute("class", edge.oneWay ? "edge" : "edge muted");
    line.setAttribute("marker-end", edge.oneWay ? "url(#arrow)" : "url(#arrow-muted)");
    els.edgesLayer.appendChild(line);

    if (edge.label) {
      const midX = (fromPos.x + toPos.x) / 2;
      const midY = (fromPos.y + toPos.y) / 2;
      const label = svgEl("text");
      label.textContent = edge.label;
      label.setAttribute("x", midX + 8);
      label.setAttribute("y", midY - 6);
      label.setAttribute("class", "edge-label");
      els.edgesLayer.appendChild(label);
    }
  }

  const classForCategory = (category) => {
    switch (category) {
      case "spawn":
        return "hub-node-spawn";
      case "grotto":
        return "hub-node-grotto";
      case "dungeon":
        return "hub-node-dungeon";
      case "boss":
        return "hub-node-boss";
      case "interior":
        return "hub-node-interior";
      default:
        return "hub-node";
    }
  };

  for (const node of graph.nodes.values()) {
    const pos = state.positions.get(node.key);
    if (!pos) continue;

    const group = svgEl("g");
    const circle = svgEl("circle");
    const text = svgEl("text");

    circle.setAttribute("cx", pos.x);
    circle.setAttribute("cy", pos.y);
    circle.setAttribute("r", 50);
    const baseClass = classForCategory(node.category);
    const currentClass = state.currentNodeKey === node.key ? " hub-node-current" : "";
    circle.setAttribute("class", `${baseClass}${currentClass}`);

    text.textContent = node.label;
    text.setAttribute("x", pos.x);
    text.setAttribute("y", pos.y + 4);
    text.setAttribute("text-anchor", "middle");
    text.setAttribute("class", "hub-label");

    group.appendChild(circle);
    group.appendChild(text);

    els.nodesLayer.appendChild(group);
  }

  updateViewBox();
};

const updateSeedStatus = () => {
  if (!state.seedInfo) {
    els.seedStatus.textContent = "Seed: unknown";
    els.modeStatus.textContent = "Entrances: —";
    return;
  }
  els.seedStatus.textContent = state.seedInfo.entranceRando
    ? "Seed: entrance rando"
    : "Seed: vanilla";
  const decoupled = !!state.seedInfo.decoupledEntrances;
  els.modeStatus.textContent = decoupled ? "Entrances: decoupled" : "Entrances: coupled";
};

const updateCurrentScene = () => {
  if (!state.currentScene) {
    els.currentScenePill.textContent = "Current: —";
    return;
  }
  const sceneNum = toNumber(state.currentScene.sceneNum);
  const label = state.currentScene.sceneName || getSceneLabel(sceneNum);
  const spawn = state.currentScene.spawn ?? "?";
  els.currentScenePill.textContent = `Current: ${label} (spawn ${spawn})`;

  const entranceId =
    toNumber(state.currentScene.lastOverrideEntrance) ?? toNumber(state.currentScene.lastEntranceIndex);
  let nodeKey = null;
  if (entranceId != null) {
    const metaMap = buildMetaMap(state.entranceMap?.connections || []);
    nodeKey = getNodeKeyForEntrance(entranceId, metaMap.get(entranceId));
  }
  if (!nodeKey && sceneNum != null) {
    nodeKey = `scene:${sceneNum}`;
  }
  state.currentNodeKey = nodeKey;
};

const renderCurrentScene = () => {
  updateCurrentScene();
  render();
};

const updateViewBox = () => {
  if (!els.mapSvg) return;
  const { x, y, w, h } = state.viewBox;
  els.mapSvg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
};

const locatePlayer = () => {
  const key = state.currentNodeKey;
  if (!key) return;
  const pos = state.positions.get(key);
  if (!pos) return;
  const size = 600;
  state.viewBox = { x: pos.x - size / 2, y: pos.y - size / 2, w: size, h: size };
  updateViewBox();
};

let isPanning = false;
let panStart = { x: 0, y: 0, vx: 0, vy: 0 };

const startPan = (event) => {
  isPanning = true;
  panStart = {
    x: event.clientX,
    y: event.clientY,
    vx: state.viewBox.x,
    vy: state.viewBox.y,
  };
};

const movePan = (event) => {
  if (!isPanning) return;
  const dx = (event.clientX - panStart.x) * (state.viewBox.w / els.mapSvg.clientWidth);
  const dy = (event.clientY - panStart.y) * (state.viewBox.h / els.mapSvg.clientHeight);
  state.viewBox.x = panStart.vx - dx;
  state.viewBox.y = panStart.vy - dy;
  updateViewBox();
};

const endPan = () => {
  isPanning = false;
};

const zoom = (event) => {
  event.preventDefault();
  const scale = event.deltaY > 0 ? 1.08 : 0.92;
  const rect = els.mapSvg.getBoundingClientRect();
  const mx = ((event.clientX - rect.left) / rect.width) * state.viewBox.w + state.viewBox.x;
  const my = ((event.clientY - rect.top) / rect.height) * state.viewBox.h + state.viewBox.y;
  state.viewBox.w *= scale;
  state.viewBox.h *= scale;
  state.viewBox.x = mx - (mx - state.viewBox.x) * scale;
  state.viewBox.y = my - (my - state.viewBox.y) * scale;
  updateViewBox();
};

const connect = () => {
  if (state.socket) {
    state.socket.close();
  }
  const url = els.wsUrl.value;
  debugLog("ws connect", url);
  const ws = new WebSocket(url);
  state.socket = ws;
  ws.addEventListener("open", () => {
    els.wsStatus.textContent = "Connected";
    els.wsStatus.className = "pill pill-accent";
    els.connectBtn.disabled = true;
    els.disconnectBtn.disabled = false;
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(loadState, 3000);
  });
  ws.addEventListener("close", () => {
    els.wsStatus.textContent = "Disconnected";
    els.wsStatus.className = "pill";
    els.connectBtn.disabled = false;
    els.disconnectBtn.disabled = true;
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  });
  ws.addEventListener("message", (event) => {
    if (typeof event.data !== "string") return;
    let payload = null;
    try {
      payload = JSON.parse(event.data);
    } catch (err) {
      debugLog("ws parse failed", String(err));
      return;
    }
    handlePayload(payload);
  });
  ws.addEventListener("error", (event) => {
    debugLog("ws error", event?.message || "unknown");
  });
};

const disconnect = () => {
  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
};

const loadState = () => {
  const url = els.wsUrl.value.replace("ws://", "http://").replace("/ws", "/state");
  debugLog("fetch", url);
  fetch(url)
    .then((res) => res.text())
    .then((text) => {
      debugLog("payload bytes", text.length);
      let data = null;
      try {
        data = JSON.parse(text);
      } catch (err) {
        debugLog("state parse failed", String(err));
        return;
      }
      state.seedInfo = data.seedInfo || state.seedInfo;
      state.entranceMap = data.entranceMap || state.entranceMap;
      state.currentScene = data.currentScene || state.currentScene;
      state.transitions = Array.isArray(data.transitions) ? data.transitions : state.transitions;
      updateSeedStatus();
      renderCurrentScene();
    })
    .catch((err) => {
      debugLog("state fetch failed", String(err));
    });
};

const handlePayload = (payload) => {
  debugLog("ws payload", payload?.type || "unknown");
  switch (payload.type) {
    case "seed_info":
      state.seedInfo = payload;
      updateSeedStatus();
      return;
    case "entrance_map":
      state.entranceMap = payload;
      renderCurrentScene();
      return;
    case "current_scene":
      state.currentScene = payload;
      renderCurrentScene();
      loadState();
      return;
    case "transition":
      state.transitions.push(payload);
      return;
    case "transition_history":
      state.transitions = payload.transitions || [];
      return;
    default:
      return;
  }
};

const setLabelVisibility = () => {
  document.body.classList.toggle("show-labels", state.showLabels);
  if (els.toggleLabelsBtn) {
    els.toggleLabelsBtn.textContent = state.showLabels ? "Hide Labels" : "Show Labels";
  }
};

const init = async () => {
  debugLog("init start");
  state.db = await loadDatabase();
  debugLog("database", state.db ? "loaded" : "missing");

  bind(els.connectBtn, "click", connect, "connectBtn");
  bind(els.disconnectBtn, "click", disconnect, "disconnectBtn");
  bind(els.loadStateBtn, "click", loadState, "loadStateBtn");
  bind(els.resetBtn, "click", () => {
    state.viewBox = { x: 0, y: 0, w: CANVAS, h: CANVAS };
    updateViewBox();
  }, "resetBtn");
  bind(els.clearBtn, "click", () => {
    state.entranceMap = null;
    clearMap();
    if (els.emptyState) els.emptyState.style.display = "grid";
  }, "clearBtn");
  bind(els.debugPortsBtn, "click", () => {
    state.showPorts = !state.showPorts;
    debugLog("anchors", state.showPorts);
  }, "debugPortsBtn");
  bind(els.toggleLabelsBtn, "click", () => {
    state.showLabels = !state.showLabels;
    setLabelVisibility();
  }, "toggleLabelsBtn");
  bind(els.locateBtn, "click", locatePlayer, "locateBtn");
  bind(els.clearDebugBtn, "click", () => {
    if (els.debugOutput) els.debugOutput.textContent = "";
  }, "clearDebugBtn");

  bind(document, "click", (event) => {
    const button = event.target?.closest?.("button");
    if (!button) return;
    const label = button.textContent ? button.textContent.trim() : "button";
    showClick(label || "button");
  }, "document click");

  bind(els.mapSvg, "mousedown", startPan, "mapSvg mousedown");
  bind(window, "mousemove", movePan, "window mousemove");
  bind(window, "mouseup", endPan, "window mouseup");
  if (els.mapSvg) {
    els.mapSvg.addEventListener("wheel", zoom, { passive: false });
  }

  updateViewBox();
  setLabelVisibility();
  render();

  debugLog("init done");
  showClick("ready");
};

init();
