const VALID_ROLES = new Set(["mechanic", "illusionist", "summoner", "lord"]);
const ONLINE_WINDOW_MS = 90_000;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function error(message, status = 400) {
  return json({ error: message }, status);
}

function bearer(request) {
  const value = request.headers.get("authorization") || "";
  return value.startsWith("Bearer ") ? value.slice(7) : "";
}

function requireHost(request, env) {
  return Boolean(env.HOST_TOKEN && bearer(request) === env.HOST_TOKEN);
}

async function tokenHash(token) {
  const data = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function requireParticipant(request, env, participantId) {
  const token = request.headers.get("x-participant-token");
  if (!token) return false;
  const row = await env.DB.prepare("SELECT token_hash FROM participants WHERE id = ?").bind(participantId).first();
  return Boolean(row && row.token_hash === await tokenHash(token));
}

function parseParticipant(row, now = Date.now()) {
  if (!row) return null;
  return {
    id: row.id,
    nickname: row.nickname,
    role: row.role,
    skills: JSON.parse(row.skills_json || "[]"),
    greeting: row.greeting || "",
    socialEnergy: Math.min(5, Math.max(1, Number(row.social_energy || 3))),
    photo: row.photo_key ? `/api/photos/${encodeURIComponent(row.photo_key)}` : "",
    wall: Boolean(row.wall_enabled),
    match: Boolean(row.match_enabled),
    online: now - Number(row.updated_at) <= ONLINE_WINDOW_MS,
    joinedAt: new Date(Number(row.created_at)).toISOString(),
  };
}

function parseEvent(row) {
  if (!row) return { mode: "idle", endsAt: null, round: 0, matchCount: 0 };
  return {
    mode: row.mode,
    endsAt: row.ends_at == null ? null : Number(row.ends_at),
    round: Number(row.round || 0),
    matchCount: Number(row.match_count || 0),
  };
}

function validateParticipant(payload) {
  const nickname = String(payload.nickname || "").trim().slice(0, 20);
  const role = String(payload.role || "");
  const skills = Array.isArray(payload.skills)
    ? payload.skills.map((item) => String(item).trim().slice(0, 20)).filter(Boolean).slice(0, 3)
    : [];
  if (nickname.length < 2) throw new Error("暱稱至少需要 2 個字");
  if (!VALID_ROLES.has(role)) throw new Error("請選擇一個公會角色");
  if (!skills.length) throw new Error("請至少填寫一項技能");
  const socialEnergy = Math.round(Number(payload.socialEnergy || 3));
  if (!Number.isInteger(socialEnergy) || socialEnergy < 1 || socialEnergy > 5) throw new Error("社交指數需要介於 1 到 5");
  return {
    nickname,
    role,
    skills,
    greeting: String(payload.greeting || "").trim().slice(0, 40),
    socialEnergy,
    wall: payload.wall !== false,
    match: payload.match !== false,
  };
}

async function ensureEvent(env) {
  const now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO event_state (id, mode, ends_at, round, match_count, updated_at) VALUES (1, 'idle', NULL, 0, 0, ?)").bind(now).run();
  return env.DB.prepare("SELECT * FROM event_state WHERE id = 1").first();
}

export function buildMatchAssignments(input, previousPairs = [], random = Math.random) {
  const participants = input.map((item) => typeof item === "string"
    ? { id: item, socialEnergy: 3 }
    : { id: item.id, socialEnergy: Math.min(5, Math.max(1, Number(item.socialEnergy || item.social_energy || 3))) });
  if (participants.length < 2) return [];

  const ordered = [...participants].sort((a, b) => a.socialEnergy - b.socialEnergy || a.id.localeCompare(b.id));
  const previous = new Set(previousPairs.map((pair) => `${pair.participantId || pair.participant_id}:${pair.targetId || pair.target_id}`));
  const candidates = [];
  const addCandidate = (targets) => {
    if (targets.some((target, index) => target.id === ordered[index].id)) return;
    const key = targets.map((target) => target.id).join("|");
    if (!candidates.some((candidate) => candidate.key === key)) candidates.push({ key, targets });
  };

  for (let offset = 1; offset < ordered.length; offset += 1) {
    addCandidate(ordered.map((_, index) => ordered[(index + offset) % ordered.length]));
  }
  const reversed = [...ordered].sort((a, b) => b.socialEnergy - a.socialEnergy || a.id.localeCompare(b.id));
  for (let offset = 0; offset < reversed.length; offset += 1) {
    addCandidate(reversed.map((_, index) => reversed[(index + offset) % reversed.length]));
  }
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const shuffled = [...ordered];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const other = Math.floor(random() * (index + 1));
      [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
    }
    addCandidate(shuffled);
  }

  const score = (targets) => targets.reduce((total, target, index) => {
    const participant = ordered[index];
    const contrast = Math.abs(participant.socialEnergy - target.socialEnergy) * 20;
    const anchorExplorer = (participant.socialEnergy <= 2 && target.socialEnergy >= 4)
      || (participant.socialEnergy >= 4 && target.socialEnergy <= 2) ? 70 : 0;
    const repeated = previous.has(`${participant.id}:${target.id}`) ? 500 : 0;
    return total + contrast + anchorExplorer - repeated;
  }, 0);
  const best = candidates.sort((a, b) => score(b.targets) - score(a.targets))[0];
  return best.targets.map((target, index) => ({ participantId: ordered[index].id, targetId: target.id }));
}

async function handleParticipants(request, env) {
  if (request.method !== "POST") return error("不支援的請求", 405);
  const participantToken = request.headers.get("x-participant-token");
  if (!participantToken) return error("缺少裝置驗證資訊", 401);
  const payload = await request.json().catch(() => null);
  if (!payload || !/^[a-zA-Z0-9-]{8,80}$/.test(String(payload.id || ""))) return error("無效的報到識別碼");
  let data;
  try { data = validateParticipant(payload); } catch (nextError) { return error(nextError.message); }
  const id = String(payload.id);
  const existing = await env.DB.prepare("SELECT token_hash FROM participants WHERE id = ?").bind(id).first();
  const hash = await tokenHash(participantToken);
  if (existing && existing.token_hash !== hash) return error("這張識別卡屬於另一台裝置", 403);
  const now = Date.now();
  await env.DB.prepare(`
    INSERT INTO participants (id, token_hash, nickname, role, skills_json, greeting, social_energy, photo_key, wall_enabled, match_enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nickname = excluded.nickname, role = excluded.role,
      skills_json = excluded.skills_json, greeting = excluded.greeting, social_energy = excluded.social_energy,
      wall_enabled = excluded.wall_enabled, match_enabled = excluded.match_enabled,
      updated_at = excluded.updated_at
  `).bind(id, hash, data.nickname, data.role, JSON.stringify(data.skills), data.greeting, data.socialEnergy, Number(data.wall), Number(data.match), now, now).run();
  const row = await env.DB.prepare("SELECT * FROM participants WHERE id = ?").bind(id).first();
  return json(parseParticipant(row));
}

async function handleParticipant(request, env, participantId, action) {
  if (!await requireParticipant(request, env, participantId)) return error("無權存取這張識別卡", 403);
  if (action === "heartbeat" && request.method === "POST") {
    await env.DB.prepare("UPDATE participants SET updated_at = ? WHERE id = ?").bind(Date.now(), participantId).run();
    return json({ ok: true });
  }
  if (action === "photo" && request.method === "POST") {
    if (!env.UPLOADS) return error("圖片儲存服務尚未啟用", 503);
    const contentType = request.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) return error("只接受圖片檔案");
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength || bytes.byteLength > 2_500_000) return error("照片大小需小於 2.5 MB");
    const previous = await env.DB.prepare("SELECT photo_key FROM participants WHERE id = ?").bind(participantId).first();
    const extension = contentType.includes("png") ? "png" : "jpg";
    const key = `participants/${participantId}/${crypto.randomUUID()}.${extension}`;
    await env.UPLOADS.put(key, bytes, { httpMetadata: { contentType } });
    await env.DB.prepare("UPDATE participants SET photo_key = ?, updated_at = ? WHERE id = ?").bind(key, Date.now(), participantId).run();
    if (previous?.photo_key) await env.UPLOADS.delete(previous.photo_key).catch(() => {});
    return json({ photo: `/api/photos/${encodeURIComponent(key)}` });
  }
  if (!action && request.method === "GET") {
    const row = await env.DB.prepare("SELECT * FROM participants WHERE id = ?").bind(participantId).first();
    if (!row) return error("找不到這張識別卡", 404);
    return json(parseParticipant(row));
  }
  return error("不支援的請求", 405);
}

async function handlePhoto(request, env, key) {
  if (request.method !== "GET" || !env.UPLOADS) return error("找不到照片", 404);
  const object = await env.UPLOADS.get(key);
  if (!object) return error("找不到照片", 404);
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", "public, max-age=86400");
  return new Response(object.body, { headers });
}

async function handleEvent(env) {
  return json(parseEvent(await ensureEvent(env)));
}

async function handleHost(request, env, path) {
  if (!requireHost(request, env)) return error("工作人員連結無效", 403);
  if (path === "/api/host/verify" && request.method === "GET") return json({ ok: true });
  if (path === "/api/host/participants" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM participants ORDER BY created_at DESC").all();
    return json({ participants: rows.results.map((row) => parseParticipant(row)) });
  }
  if (path === "/api/host/event" && request.method === "POST") {
    const payload = await request.json().catch(() => ({}));
    const current = parseEvent(await ensureEvent(env));
    const now = Date.now();
    if (payload.mode === "countdown") {
      const duration = Math.min(600, Math.max(5, Number(payload.durationSeconds) || 30));
      await env.DB.prepare("UPDATE event_state SET mode = 'countdown', ends_at = ?, round = ?, match_count = 0, updated_at = ? WHERE id = 1").bind(now + duration * 1000, current.round + 1, now).run();
    } else if (payload.mode === "idle") {
      await env.DB.prepare("UPDATE event_state SET mode = 'idle', ends_at = NULL, match_count = 0, updated_at = ? WHERE id = 1").bind(now).run();
    } else return error("無效的活動狀態");
    return handleEvent(env);
  }
  if (path === "/api/host/complete-round" && request.method === "POST") {
    const row = await ensureEvent(env);
    const current = parseEvent(row);
    if (current.mode === "matched") return json(current);
    if (current.mode !== "countdown" || Date.now() < Number(current.endsAt)) return error("倒數尚未結束", 409);
    const candidates = await env.DB.prepare("SELECT id, social_energy FROM participants WHERE match_enabled = 1 AND updated_at >= ? ORDER BY updated_at DESC").bind(Date.now() - ONLINE_WINDOW_MS).all();
    const history = await env.DB.prepare("SELECT participant_id, target_id FROM matches WHERE round < ?").bind(current.round).all();
    const assignments = buildMatchAssignments(candidates.results, history.results);
    const statements = [env.DB.prepare("DELETE FROM matches WHERE round = ?").bind(current.round)];
    const now = Date.now();
    for (const assignment of assignments) {
      statements.push(env.DB.prepare("INSERT INTO matches (round, participant_id, target_id, created_at) VALUES (?, ?, ?, ?)").bind(current.round, assignment.participantId, assignment.targetId, now));
    }
    statements.push(env.DB.prepare("UPDATE event_state SET mode = 'matched', ends_at = NULL, match_count = ?, updated_at = ? WHERE id = 1").bind(assignments.length, now));
    await env.DB.batch(statements);
    return handleEvent(env);
  }
  if (path === "/api/host/reset" && request.method === "DELETE") {
    const photos = await env.DB.prepare("SELECT photo_key FROM participants WHERE photo_key IS NOT NULL").all();
    await env.DB.batch([
      env.DB.prepare("DELETE FROM matches"),
      env.DB.prepare("DELETE FROM participants"),
      env.DB.prepare("UPDATE event_state SET mode = 'idle', ends_at = NULL, round = 0, match_count = 0, updated_at = ? WHERE id = 1").bind(Date.now()),
    ]);
    if (env.UPLOADS && photos.results.length) await env.UPLOADS.delete(photos.results.map((item) => item.photo_key)).catch(() => {});
    return json({ ok: true });
  }
  return error("找不到工作人員功能", 404);
}

async function handleMyMatch(request, env, url) {
  const participantId = url.searchParams.get("participantId") || "";
  if (!await requireParticipant(request, env, participantId)) return error("無權讀取媒合結果", 403);
  const event = parseEvent(await ensureEvent(env));
  if (event.mode !== "matched") return json({ match: null });
  const row = await env.DB.prepare(`
    SELECT target.* FROM matches
    JOIN participants AS target ON target.id = matches.target_id
    WHERE matches.round = ? AND matches.participant_id = ?
    LIMIT 1
  `).bind(event.round, participantId).first();
  return json({ match: parseParticipant(row) });
}

async function handleApi(request, env, url) {
  if (!env.DB) return error("資料庫尚未啟用", 503);
  if (url.pathname.startsWith("/api/host/")) return handleHost(request, env, url.pathname);
  if (url.pathname === "/api/event" && request.method === "GET") return handleEvent(env);
  if (url.pathname === "/api/participants") return handleParticipants(request, env);
  if (url.pathname === "/api/matches/me" && request.method === "GET") return handleMyMatch(request, env, url);
  if (url.pathname.startsWith("/api/photos/")) return handlePhoto(request, env, decodeURIComponent(url.pathname.slice("/api/photos/".length)));
  const participantMatch = url.pathname.match(/^\/api\/participants\/([^/]+)(?:\/(heartbeat|photo))?$/);
  if (participantMatch) return handleParticipant(request, env, decodeURIComponent(participantMatch[1]), participantMatch[2]);
  return error("找不到 API", 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await handleApi(request, env, url); }
      catch (nextError) { return error(nextError.message || "伺服器發生錯誤", 500); }
    }
    const response = await env.ASSETS.fetch(request);
    const acceptsHtml = request.headers.get("accept")?.includes("text/html");
    if (response.status !== 404 || !acceptsHtml || !["GET", "HEAD"].includes(request.method)) return response;
    const indexUrl = new URL(request.url); indexUrl.pathname = "/index.html"; indexUrl.search = "";
    return env.ASSETS.fetch(new Request(indexUrl, request));
  },
};
