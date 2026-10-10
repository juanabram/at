(() => {
  "use strict";

  const WIDTH = 21;
  const HEIGHT = 13;
  const CELL = 52;
  const STARS_PER_ROUND = 8;
  const SPAWN_MS = 6000;
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const WALLS = new Set([
    "4,1", "4,2", "4,3", "8,2", "8,3", "8,4", "13,1", "13,2", "13,3", "17,2", "17,3", "17,4",
    "3,6", "4,6", "9,6", "10,6", "12,6", "13,6", "6,7", "7,7", "17,7", "18,7",
    "3,9", "4,9", "5,9", "9,9", "9,10", "9,11", "14,9", "14,10", "14,11", "18,10", "19,10"
  ]);
  const custom = window.PERSONALIZAR || {};
  const $ = (id) => document.getElementById(id);
  const canvas = $("board");
  const ctx = canvas.getContext("2d");
  const pixelRatio = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);
  canvas.width = WIDTH * CELL * pixelRatio;
  canvas.height = HEIGHT * CELL * pixelRatio;
  ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  const sprites = new Map();
  const particles = [];
  const state = {
    mode: null, room: "", uid: "", player: null, players: {}, claims: {},
    stars: [], phase: null, round: -1, config: null, startAt: 0, clockOffset: 0,
    connected: false, session: null, pendingClaims: new Set(), lastMove: 0
  };
  let db = null;
  let auth = null;
  let animationId = null;
  let busy = false;
  let activeDrawer = null;

  function firebaseSettings() {
    return typeof firebaseConfig !== "undefined" ? firebaseConfig : (window.FIREBASE_CONFIG || {});
  }

  function configured() {
    const config = firebaseSettings();
    return ["apiKey", "authDomain", "databaseURL", "projectId", "appId"]
      .every((key) => typeof config[key] === "string" && config[key].trim());
  }

  function applyCustomizations() {
    $("game-title").textContent = custom.titulo || "¡Atrapen las estrellas!";
    $("game-subtitle").textContent = custom.subtitulo || "Recoge estrellas antes de que termine el tiempo. ¡Gana quien consiga más!";
    $("mission-message").textContent = custom.mensajeMision || "Consigue más estrellas que los demás.";
    $("win-message").querySelector("h2").textContent = custom.mensajeFinal || "¡Tiempo!";
    $("setup-hint").hidden = configured();
    $("create-room").disabled = !configured();
    $("join-room").disabled = !configured();
  }

  function showError(message) {
    $("home-error").textContent = message;
    $("home-error").hidden = false;
  }

  function clearError() { $("home-error").hidden = true; }
  function notice(message) { $("game-notice").textContent = message; }

  function getName() {
    const name = $("player-name").value.trim().replace(/\s+/g, " ");
    if (!name || name.length > 16) {
      showError("Escribe un nombre de 1 a 16 caracteres.");
      $("player-name").focus();
      return null;
    }
    return name;
  }

  function randomCode() {
    const values = new Uint8Array(6);
    if (window.crypto?.getRandomValues) window.crypto.getRandomValues(values);
    else values.forEach((_, index) => { values[index] = Math.floor(Math.random() * 256); });
    return Array.from(values, (value) => ALPHABET[value % ALPHABET.length]).join("");
  }

  function hashString(value) {
    let hash = 2166136261;
    for (const char of value) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return hash >>> 0;
  }

  function makeStars(code, round) {
    let seed = hashString(`${code}:${round}`) || 1;
    const available = [];
    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        if (!WALLS.has(`${x},${y}`) && !(x < 3 && y < 3)) available.push({ x, y });
      }
    }
    for (let i = available.length - 1; i > 0; i--) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const j = seed % (i + 1);
      [available[i], available[j]] = [available[j], available[i]];
    }
    return available.slice(0, STARS_PER_ROUND);
  }

  function initialPosition(uid) {
    const index = hashString(uid) % 5;
    return [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }, { x: 2, y: 2 }, { x: 0, y: 1 }][index];
  }

  function playerColor(index) {
    const colors = Array.isArray(custom.coloresJugadores) && custom.coloresJugadores.length
      ? custom.coloresJugadores : ["#7ce8d6", "#ff91ab", "#b5a0ff", "#ffbd79"];
    return colors[index % colors.length] || "#7ce8d6";
  }

  function selectedDurationMs() {
    const minutes = Number($("duration").value);
    return [1, 2, 3].includes(minutes) ? minutes * 60000 : 60000;
  }

  function openGame(mode, code, player, uid, config) {
    closeDrawer(false);
    state.mode = mode;
    state.room = code;
    state.uid = uid;
    state.player = player;
    state.players = { [uid]: player };
    state.claims = {};
    state.stars = [];
    state.phase = mode === "solo" ? "running" : "waiting";
    state.round = -1;
    state.config = config;
    state.startAt = mode === "solo" ? Date.now() : 0;
    state.pendingClaims.clear();
    state.lastMove = 0;
    sprites.clear();
    particles.length = 0;
    state.connected = mode === "solo";
    $("room-label").textContent = mode === "solo" ? "de práctica" : code;
    $("mode-label").textContent = mode === "solo" ? "Prueba individual" : "Comparte el código con tu equipo";
    $("copy-link").hidden = mode === "solo";
    $("home").hidden = true;
    $("game").hidden = false;
    $("win-message").hidden = true;
    $("progress").max = config.durationMs / 1000;
    $("start-game").disabled = mode !== "solo";
    $("lobby-message").textContent = "Comparte el código. Cuando estén todos, cualquiera puede iniciar.";
    notice("");
    advanceClock();
    updateHud();
    if (!animationId) animationId = requestAnimationFrame(draw);
    window.scrollTo(0, 0);
  }

  function startSolo() {
    clearError();
    const name = getName();
    if (!name) return;
    const player = { name, ...initialPosition("solo"), color: 0 };
    state.clockOffset = 0;
    openGame("solo", "PRACTICA", player, "solo", { version: 2, durationMs: selectedDurationMs(), spawnMs: SPAWN_MS });
  }

  function setBusy(value) {
    busy = value;
    $("create-room").disabled = value || !configured();
    $("join-room").disabled = value || !configured();
    $("solo-button").disabled = value;
  }

  async function connectFirebase() {
    if (!configured()) throw new Error("Falta configurar Firebase. Por ahora puedes probar a solas.");
    if (!window.firebase?.database || !window.firebase?.auth) throw new Error("No cargó Firebase. Comprueba tu conexión a internet y recarga la página.");
    if (!window.firebase.apps.length) window.firebase.initializeApp(firebaseSettings());
    auth ||= window.firebase.auth();
    db ||= window.firebase.database();
    const credential = auth.currentUser ? { user: auth.currentUser } : await auth.signInAnonymously();
    return credential.user.uid;
  }

  async function enterOnline(code, create = false) {
    if (busy) return;
    clearError();
    const name = getName();
    if (!name) return;
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(code)) {
      showError("El código debe tener 6 letras o números. Compruébalo con tu equipo.");
      return;
    }
    setBusy(true);
    try {
      const uid = await connectFirebase();
      const offsetSnapshot = await db.ref(".info/serverTimeOffset").once("value");
      state.clockOffset = Number(offsetSnapshot.val()) || 0;
      const configRef = db.ref(`rooms/${code}/config`);
      let config;
      if (create) {
        const settings = { version: 2, durationMs: selectedDurationMs(), spawnMs: SPAWN_MS };
        const result = await configRef.transaction((current) => current === null ? settings : undefined, undefined, false);
        if (!result.committed) throw new Error("Ese código ya existe. Pulsa Crear sala otra vez.");
        config = result.snapshot.val();
      } else {
        config = (await configRef.once("value")).val();
        if (!config) throw new Error("No existe esa sala. Pide un código nuevo al equipo.");
      }
      if (config.version !== 2 || ![60000, 120000, 180000].includes(config.durationMs) || config.spawnMs !== SPAWN_MS) {
        throw new Error("Esta sala usa otra versión del juego. Crea una sala nueva.");
      }
      const startRef = db.ref(`rooms/${code}/startAt`);
      const startAt = Number((await startRef.once("value")).val()) || 0;
      if (startAt && Date.now() + state.clockOffset >= startAt + config.durationMs) {
        throw new Error("Esta partida ya terminó. Crea una sala nueva.");
      }
      const position = initialPosition(uid);
      const color = hashString(uid) % 6;
      const player = { name, ...position, color };
      openGame("online", code, player, uid, config);
      state.startAt = startAt;
      advanceClock();
      const session = {
        room: code, playerRef: db.ref(`rooms/${code}/players/${uid}`),
        playersRef: db.ref(`rooms/${code}/players`), starsRef: db.ref(`rooms/${code}/stars`),
        startRef, connectedRef: db.ref(".info/connected"), offsetRef: db.ref(".info/serverTimeOffset")
      };
      state.session = session;
      state.connected = false;
      $("status-label").textContent = "Conectando…";
      attachSession(session);
      const url = new URL(window.location.href);
      url.searchParams.set("sala", code);
      window.history.replaceState({}, "", url);
    } catch (error) {
      await leaveGame(false);
      showError(friendlyError(error));
    } finally { setBusy(false); }
  }

  function friendlyError(error) {
    const message = String(error?.message || error || "Error desconocido");
    if (/auth\/operation-not-allowed/.test(message)) return "Activa el acceso anónimo en Firebase Authentication.";
    if (/permission_denied|PERMISSION_DENIED/i.test(message)) return "Firebase rechazó el acceso. Revisa las reglas de Realtime Database.";
    if (/auth\/unauthorized-domain/.test(message)) return "Autoriza el dominio de GitHub Pages en Firebase Authentication.";
    return message;
  }

  function attachSession(session) {
    session.onPlayers = (snapshot) => {
      if (state.session !== session) return;
      state.players = snapshot.val() || {};
      updateHud();
    };
    session.onStars = (snapshot) => {
      if (state.session !== session) return;
      const nextClaims = snapshot.val() || {};
      if (session.receivedStars) {
        const currentRound = String(state.round);
        for (const index of Object.keys(nextClaims[currentRound] || {})) {
          if (!state.claims[currentRound]?.[index]) burstAtStar(Number(index));
        }
      }
      session.receivedStars = true;
      state.claims = nextClaims;
      updateHud();
    };
    session.onStart = (snapshot) => {
      if (state.session !== session) return;
      state.startAt = Number(snapshot.val()) || 0;
      advanceClock();
    };
    session.onOffset = (snapshot) => {
      if (state.session !== session) return;
      state.clockOffset = Number(snapshot.val()) || 0;
      advanceClock();
    };
    session.onConnection = async (snapshot) => {
      if (state.session !== session) return;
      state.connected = false;
      if (snapshot.val() !== true) {
        $("status-label").textContent = "Reconectando…";
        $("start-game").disabled = true;
        return;
      }
      try {
        await session.playerRef.onDisconnect().remove();
        if (state.session !== session) return;
        await session.playerRef.set(state.player);
        if (state.session !== session) return;
        state.connected = true;
        $("start-game").disabled = false;
        $("status-label").textContent = state.phase === "waiting" ? "Esperando al equipo" : state.phase === "finished" ? "Tiempo terminado" : "En línea con tu equipo";
      } catch (error) {
        state.connected = false;
        $("status-label").textContent = "No se pudo conectar";
        notice(friendlyError(error));
      }
    };
    const onReadError = (error) => {
      if (state.session !== session) return;
      state.connected = false;
      $("status-label").textContent = "Acceso denegado";
      notice(friendlyError(error));
    };
    session.playersRef.on("value", session.onPlayers, onReadError);
    session.starsRef.on("value", session.onStars, onReadError);
    session.startRef.on("value", session.onStart, onReadError);
    session.offsetRef.on("value", session.onOffset);
    session.connectedRef.on("value", session.onConnection, onReadError);
  }

  async function startMatch() {
    const session = state.session;
    if (!session || !state.connected || state.startAt) return;
    $("start-game").disabled = true;
    try {
      await session.startRef.set(firebase.database.ServerValue.TIMESTAMP);
    } catch (error) {
      if (state.session === session && !state.startAt) {
        $("start-game").disabled = false;
        notice(friendlyError(error));
      }
    }
  }

  async function leaveGame(clearUrl = true) {
    const session = state.session;
    state.session = null;
    state.mode = null;
    state.connected = false;
    closeDrawer(false);
    if (session) {
      session.playersRef.off("value", session.onPlayers);
      session.starsRef.off("value", session.onStars);
      session.startRef.off("value", session.onStart);
      session.offsetRef.off("value", session.onOffset);
      session.connectedRef.off("value", session.onConnection);
      try { await session.playerRef.onDisconnect().cancel(); } catch (_) { /* Continúa la salida. */ }
      try { await session.playerRef.remove(); } catch (_) { /* Se retirará al desconectarse. */ }
    }
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
    $("game").hidden = true;
    $("home").hidden = false;
    if (clearUrl) {
      const url = new URL(window.location.href);
      url.searchParams.delete("sala");
      window.history.replaceState({}, "", url);
    }
  }

  function move(dx, dy) {
    if (!state.mode) return;
    advanceClock();
    if (state.phase !== "running" || (state.mode === "online" && !state.connected)) return;
    const now = performance.now();
    if (now - state.lastMove < 105) return;
    state.lastMove = now;
    const x = state.player.x + dx;
    const y = state.player.y + dy;
    if (x < 0 || x >= WIDTH || y < 0 || y >= HEIGHT || WALLS.has(`${x},${y}`)) return;
    state.player = { ...state.player, x, y };
    state.players[state.uid] = state.player;
    if (state.mode === "online") {
      const session = state.session;
      session?.playerRef.update({ x, y }).catch((error) => notice(friendlyError(error)));
    }
    collectIfStar(x, y);
  }

  function collectIfStar(x, y) {
    const index = state.stars.findIndex((star) => star.x === x && star.y === y);
    const roundNumber = state.round;
    const round = String(roundNumber);
    const claimKey = `${round}:${index}`;
    if (index < 0 || state.claims[round]?.[index] || state.pendingClaims.has(claimKey)) return;
    if (state.mode === "solo") {
      (state.claims[round] ||= {})[index] = { by: state.uid, name: state.player.name, round: roundNumber };
      burstAtStar(index);
      updateHud();
      return;
    }
    const session = state.session;
    if (!session) return;
    state.pendingClaims.add(claimKey);
    session.starsRef.child(`${round}/${index}`).transaction(
      (current) => current === null ? { by: state.uid, name: state.player.name, round: roundNumber } : undefined,
      (error) => {
        state.pendingClaims.delete(claimKey);
        if (error && state.session === session) notice(friendlyError(error));
      },
      false
    );
  }

  function formatTime(seconds) {
    const whole = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(whole / 60)).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
  }

  function advanceClock() {
    if (!state.mode || !state.config) return;
    const durationMs = state.config.durationMs;
    if (!state.startAt) {
      state.phase = "waiting";
      state.stars = [];
      $("lobby-banner").hidden = false;
      $("time-left").textContent = formatTime(durationMs / 1000);
      $("progress").value = durationMs / 1000;
      $("spawn-label").textContent = "El reloj empieza al iniciar";
      return;
    }
    $("lobby-banner").hidden = true;
    const elapsed = Math.max(0, Date.now() + state.clockOffset - state.startAt);
    const remaining = Math.max(0, durationMs - elapsed);
    $("time-left").textContent = formatTime(remaining / 1000);
    $("progress").value = remaining / 1000;
    if (remaining <= 0) {
      $("spawn-label").textContent = "Partida terminada";
      if (state.phase !== "finished") {
        state.phase = "finished";
        state.round = -1;
        state.stars = [];
        state.pendingClaims.clear();
        $("win-message").hidden = false;
        $("status-label").textContent = "Tiempo terminado";
        updateHud();
      }
      return;
    }
    state.phase = "running";
    const round = Math.floor(elapsed / state.config.spawnMs);
    if (round !== state.round) {
      state.round = round;
      state.stars = makeStars(state.room, round);
      state.pendingClaims.clear();
      updateHud();
      collectIfStar(state.player.x, state.player.y);
    }
    const untilNext = state.config.spawnMs - (elapsed % state.config.spawnMs);
    $("spawn-label").textContent = untilNext < remaining
      ? `Más estrellas en ${formatTime(untilNext / 1000)}` : "Última tanda";
  }

  function updateHud() {
    const scores = new Map();
    const known = new Map(Object.entries(state.players));
    for (const round of Object.values(state.claims)) {
      for (const claim of Object.values(round || {})) {
        if (!claim?.by) continue;
        scores.set(claim.by, (scores.get(claim.by) || 0) + 1);
        if (!known.has(claim.by)) known.set(claim.by, { name: String(claim.name || "Jugador"), color: 0 });
      }
    }
    $("score").textContent = String(scores.get(state.uid) || 0);
    const list = $("player-list");
    list.replaceChildren();
    const entries = [...known].sort((a, b) => (scores.get(b[0]) || 0) - (scores.get(a[0]) || 0) || a[1].name.localeCompare(b[1].name, "es"));
    for (const [uid, player] of entries) {
      const row = document.createElement("div");
      row.className = "player-item";
      const chip = document.createElement("span");
      chip.className = "player-chip";
      chip.style.background = playerColor(Number(player.color) || 0);
      const name = document.createElement("span");
      name.textContent = String(player.name || "Jugador");
      row.append(chip, name);
      if (uid === state.uid) {
        const you = document.createElement("small");
        you.textContent = "Tú";
        row.append(you);
      }
      const points = document.createElement("span");
      points.className = "player-points";
      points.textContent = `${scores.get(uid) || 0} pts`;
      row.append(points);
      list.append(row);
    }
    if (state.phase === "finished") {
      const highest = Math.max(0, ...entries.map(([uid]) => scores.get(uid) || 0));
      const winners = entries.filter(([uid]) => (scores.get(uid) || 0) === highest).map(([, player]) => player.name);
      $("winner-line").textContent = state.mode === "solo"
        ? `Conseguiste ${highest} ${highest === 1 ? "punto" : "puntos"}.`
        : winners.length === 1
          ? `Ganó ${winners[0]} con ${highest} ${highest === 1 ? "punto" : "puntos"}.`
          : `Empate entre ${winners.join(" y ")}: ${highest} ${highest === 1 ? "punto" : "puntos"}.`;
    }
    if (state.mode === "solo" && state.phase === "running") $("status-label").textContent = "Prueba individual";
  }

  function closeDrawer(returnFocus = true) {
    $("game-drawer").hidden = true;
    $("drawer-backdrop").hidden = true;
    $("toggle-players").setAttribute("aria-expanded", "false");
    if (returnFocus && activeDrawer) $("toggle-players").focus();
    activeDrawer = null;
  }

  function showDrawer(panel) {
    if (activeDrawer === panel) { closeDrawer(); return; }
    activeDrawer = panel;
    $("game-drawer").hidden = false;
    $("drawer-backdrop").hidden = false;
    $("players-panel").hidden = panel !== "players";
    $("toggle-players").setAttribute("aria-expanded", String(panel === "players"));
    $("drawer-title").textContent = "Jugadores";
    $("close-drawer").focus();
  }

  function draw(time) {
    if (!state.mode) { animationId = null; return; }
    advanceClock();
    ctx.clearRect(0, 0, WIDTH * CELL, HEIGHT * CELL);
    drawFloor(time);
    drawWalls();
    state.stars.forEach((star, index) => {
      if (!state.claims[state.round]?.[index]) drawCollectible(star, index, time);
    });
    const activeIds = new Set(Object.keys(state.players));
    for (const uid of sprites.keys()) if (!activeIds.has(uid)) sprites.delete(uid);
    Object.entries(state.players).forEach(([uid, player], index) => drawPlayer(uid, player, index, time));
    drawParticles();
    animationId = requestAnimationFrame(draw);
  }

  function drawFloor(time) {
    ctx.fillStyle = custom.colorMapa || "#1d2648";
    ctx.fillRect(0, 0, WIDTH * CELL, HEIGHT * CELL);
    const light = ctx.createRadialGradient(WIDTH * CELL * .72, 70, 10, WIDTH * CELL * .65, 170, WIDTH * CELL * .65);
    light.addColorStop(0, "#766bc055");
    light.addColorStop(1, "#111a3300");
    ctx.fillStyle = light;
    ctx.fillRect(0, 0, WIDTH * CELL, HEIGHT * CELL);

    ctx.save();
    ctx.strokeStyle = "#aabaff24";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(WIDTH * CELL - 90, 35, 170, .25, 2.9);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(WIDTH * CELL - 90, 35, 235, .4, 2.7);
    ctx.stroke();
    ctx.restore();

    for (let y = 0; y < HEIGHT; y++) {
      for (let x = 0; x < WIDTH; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? "#ffffff09" : "#0000000b";
        rounded(x * CELL + 3, y * CELL + 3, CELL - 6, CELL - 6, 6);
        ctx.fillStyle = "#a1b6e628";
        ctx.fillRect(x * CELL + 8, y * CELL + 8, 3, 3);
      }
    }

    ctx.fillStyle = "#ffe35b";
    for (let x = 14; x < WIDTH * CELL; x += 56) {
      ctx.fillRect(x, 4, 20, 3);
      ctx.fillRect(x, HEIGHT * CELL - 7, 20, 3);
    }
    ctx.fillStyle = "#ffffff80";
    for (let i = 0; i < 30; i++) {
      const x = (i * 149 + 41) % (WIDTH * CELL);
      const y = (i * 83 + 61) % (HEIGHT * CELL);
      const pulse = .45 + Math.sin(time / 750 + i) * .35;
      ctx.globalAlpha = pulse;
      ctx.fillRect(x, y, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  function drawWalls() {
    for (const wall of WALLS) {
      const [x, y] = wall.split(",").map(Number);
      const left = x * CELL + 6;
      const top = y * CELL + 4;
      ctx.fillStyle = "#0e1835";
      rounded(left + 3, top + 6, 42, 43, 8);
      ctx.fillStyle = "#ff8266";
      rounded(left, top, 42, 42, 8);
      ctx.strokeStyle = "#122042";
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.fillStyle = "#ffc09b";
      rounded(left + 5, top + 5, 32, 14, 4);
      ctx.fillStyle = "#ffe35b";
      rounded(left + 9, top + 26, 24, 7, 2);
      ctx.fillStyle = "#1b2140";
      for (const offset of [8, 34]) {
        ctx.beginPath();
        ctx.arc(left + offset, top + 35, 2.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function drawCollectible(star, index, time) {
    const cx = star.x * CELL + CELL / 2;
    const cy = star.y * CELL + CELL / 2 + Math.sin(time / 360 + index) * 2;
    const pulse = 1 + Math.sin(time / 300 + index * 2) * .08;
    ctx.save();
    ctx.shadowColor = custom.colorEstrellas || "#ffe35b";
    ctx.shadowBlur = 20;
    ctx.fillStyle = "#ffe35b33";
    ctx.beginPath(); ctx.arc(cx, cy, 23 * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#ffe35b88";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, 19 * pulse, 0, Math.PI * 2); ctx.stroke();
    ctx.translate(cx, cy);
    ctx.rotate(Math.sin(time / 600 + index) * .14);
    ctx.fillStyle = custom.colorEstrellas || "#ffe35b";
    drawStar(0, 0, 5, 15 * pulse, 6.5 * pulse);
    ctx.strokeStyle = "#3d2e4b";
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.fillStyle = "#fff8d7";
    drawStar(-3, -4, 4, 3, 1.2);
    ctx.restore();
  }

  function drawPlayer(uid, player, index, time) {
    const targetX = Number(player.x);
    const targetY = Number(player.y);
    if (!Number.isInteger(targetX) || !Number.isInteger(targetY) || targetX < 0 || targetY < 0 || targetX >= WIDTH || targetY >= HEIGHT) return;
    let sprite = sprites.get(uid);
    if (!sprite) { sprite = { x: targetX, y: targetY }; sprites.set(uid, sprite); }
    sprite.x += (targetX - sprite.x) * .27;
    sprite.y += (targetY - sprite.y) * .27;
    const cx = sprite.x * CELL + CELL / 2;
    const cy = sprite.y * CELL + CELL / 2 + Math.sin(time / 250 + index) * 1.5;
    const color = playerColor(Number(player.color) || 0);

    ctx.fillStyle = "#08132999";
    ctx.beginPath(); ctx.ellipse(cx, cy + 19, 19, 5, 0, 0, Math.PI * 2); ctx.fill();
    if (uid === state.uid) {
      ctx.save();
      ctx.strokeStyle = "#ffe35b";
      ctx.lineWidth = 2.5;
      ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.arc(cx, cy + 1, 24, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    ctx.fillStyle = "#15203e";
    rounded(cx - 14, cy + 12, 10, 11, 3);
    rounded(cx + 4, cy + 12, 10, 11, 3);
    ctx.fillStyle = "#15203e";
    rounded(cx - 23, cy - 9, 10, 25, 4);
    ctx.fillStyle = color;
    rounded(cx - 20, cy - 6, 8, 19, 3);
    ctx.strokeStyle = "#15203e";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(cx, cy - 16); ctx.lineTo(cx, cy - 24); ctx.stroke();
    ctx.fillStyle = "#ffe35b";
    ctx.beginPath(); ctx.arc(cx, cy - 25, 4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    rounded(cx - 17, cy - 18, 34, 36, 11);
    ctx.strokeStyle = "#15203e";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = "#172848";
    rounded(cx - 14, cy - 9, 28, 16, 7);
    ctx.fillStyle = "#a8eeff";
    rounded(cx - 11, cy - 7, 22, 11, 5);
    ctx.fillStyle = "#ffffffcc";
    rounded(cx - 8, cy - 5, 10, 3, 2);
    ctx.fillStyle = "#fff7d2";
    ctx.beginPath(); ctx.arc(cx, cy + 11, 2.5, 0, Math.PI * 2); ctx.fill();

    const label = String(player.name || "Jugador").slice(0, 10);
    ctx.font = "700 10px 'Space Mono', monospace";
    const labelWidth = Math.max(38, Math.min(100, ctx.measureText(label).width + 14));
    const labelX = Math.max(labelWidth / 2 + 4, Math.min(WIDTH * CELL - labelWidth / 2 - 4, cx));
    const labelY = sprite.y < 1 ? cy + 26 : cy - 39;
    ctx.fillStyle = "#fffdf4";
    rounded(labelX - labelWidth / 2, labelY, labelWidth, 17, 5);
    ctx.strokeStyle = "#15203e";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = "#1b2140";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, labelX, labelY + 8.5);
  }

  function burstAtStar(index) {
    const star = state.stars[index];
    if (!star) return;
    const x = star.x * CELL + CELL / 2;
    const y = star.y * CELL + CELL / 2;
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const speed = 1.8 + Math.random() * 2.2;
      particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, color: i % 3 ? "#ffe35b" : "#fffdf4" });
    }
  }

  function drawParticles() {
    for (let i = particles.length - 1; i >= 0; i--) {
      const particle = particles[i];
      particle.x += particle.vx;
      particle.y += particle.vy;
      particle.vy += .035;
      particle.life -= .03;
      if (particle.life <= 0) { particles.splice(i, 1); continue; }
      ctx.globalAlpha = particle.life;
      ctx.fillStyle = particle.color;
      ctx.fillRect(particle.x - 3, particle.y - 3, 6, 6);
    }
    ctx.globalAlpha = 1;
  }

  function rounded(x, y, width, height, radius) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    ctx.fill();
  }

  function drawStar(cx, cy, points, outer, inner) {
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const angle = i * Math.PI / points - Math.PI / 2;
      const radius = i % 2 === 0 ? outer : inner;
      const x = cx + Math.cos(angle) * radius;
      const y = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }

  async function copyInvite() {
    const url = new URL(window.location.href);
    url.searchParams.set("sala", state.room);
    try {
      await navigator.clipboard.writeText(url.toString());
      notice("Enlace copiado. Compártelo con tu equipo.");
    } catch (_) {
      notice(`Comparte este código con tu equipo: ${state.room}`);
    }
  }

  $("create-room").addEventListener("click", () => enterOnline(randomCode(), true));
  $("join-room").addEventListener("click", () => enterOnline($("room-code").value.trim().toUpperCase()));
  $("room-code").addEventListener("keydown", (event) => { if (event.key === "Enter") $("join-room").click(); });
  $("solo-button").addEventListener("click", startSolo);
  $("leave-room").addEventListener("click", () => { void leaveGame(); });
  $("new-room").addEventListener("click", async () => { await leaveGame(); $("create-room").click(); });
  $("copy-link").addEventListener("click", copyInvite);
  $("start-game").addEventListener("click", startMatch);
  $("toggle-players").addEventListener("click", () => showDrawer("players"));
  $("close-drawer").addEventListener("click", () => closeDrawer());
  $("drawer-backdrop").addEventListener("click", () => closeDrawer());
  const directions = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0] };
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && activeDrawer) { closeDrawer(); return; }
    if (!state.mode || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) return;
    const direction = directions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (!direction) return;
    event.preventDefault();
    move(...direction);
  });
  const touchDirections = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
  document.querySelectorAll("[data-move]").forEach((button) => button.addEventListener("click", () => move(...touchDirections[button.dataset.move])));
  const roomFromLink = new URL(window.location.href).searchParams.get("sala");
  if (roomFromLink) $("room-code").value = roomFromLink.toUpperCase();
  applyCustomizations();
})();
