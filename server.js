const express = require('express');
const { WebSocketServer } = require('ws');
const http = require('http');
const path = require('path');

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, 'public')));

// ─── GAME CONSTANTS ───────────────────────────────────────────────
const WORLD_W = 1400;
const WORLD_H = 900;
const TICK_RATE = 60;
const MAX_ROOMS = 50;

const WALLS = [
  { x: 0,    y: 0,    w: WORLD_W, h: 20 },
  { x: 0,    y: WORLD_H - 20, w: WORLD_W, h: 20 },
  { x: 0,    y: 0,    w: 20, h: WORLD_H },
  { x: WORLD_W - 20, y: 0, w: 20, h: WORLD_H },
  { x: 580,  y: 360,  w: 240, h: 180 },
  { x: 200,  y: 200,  w: 120, h: 20 },
  { x: 200,  y: 680,  w: 120, h: 20 },
  { x: 1080, y: 200,  w: 120, h: 20 },
  { x: 1080, y: 680,  w: 120, h: 20 },
  { x: 380,  y: 300,  w: 20,  h: 160 },
  { x: 1000, y: 300,  w: 20,  h: 160 },
  { x: 380,  y: 440,  w: 20,  h: 160 },
  { x: 1000, y: 440,  w: 20,  h: 160 },
  { x: 450,  y: 420,  w: 40,  h: 40 },
  { x: 910,  y: 420,  w: 40,  h: 40 },
  { x: 680,  y: 220,  w: 40,  h: 40 },
  { x: 680,  y: 640,  w: 40,  h: 40 },
  { x: 300,  y: 420,  w: 60,  h: 60 },
  { x: 1040, y: 420,  w: 60,  h: 60 },
  { x: 150,  y: 400,  w: 80,  h: 20 },
  { x: 1170, y: 400,  w: 80,  h: 20 },
];

const SPAWNS = {
  T:  [{ x: 100, y: 200 }, { x: 100, y: 450 }, { x: 100, y: 700 }],
  CT: [{ x: 1300, y: 200 }, { x: 1300, y: 450 }, { x: 1300, y: 700 }],
};

// ─── HELPERS ──────────────────────────────────────────────────────
function circleRect(cx, cy, cr, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < cr * cr;
}

function resolveWalls(entity) {
  for (const w of WALLS) {
    if (circleRect(entity.x, entity.y, entity.radius, w.x, w.y, w.w, w.h)) {
      const cx = w.x + w.w / 2, cy = w.y + w.h / 2;
      const dx = entity.x - cx, dy = entity.y - cy;
      const halfW = w.w / 2 + entity.radius, halfH = w.h / 2 + entity.radius;
      const ox = halfW - Math.abs(dx), oy = halfH - Math.abs(dy);
      if (ox < oy) entity.x += Math.sign(dx) * ox;
      else entity.y += Math.sign(dy) * oy;
    }
  }
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function uid() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }

// ─── ROOMS ────────────────────────────────────────────────────────
const rooms = new Map(); // roomCode -> Room

class Room {
  constructor(code) {
    this.code = code;
    this.players = new Map(); // id -> PlayerState
    this.bullets = [];
    this.round = 1;
    this.roundTime = 115;
    this.score = { T: 0, CT: 0 };
    this.phase = 'waiting'; // waiting | playing | roundend
    this.tickInterval = null;
    this.lastTick = Date.now();
  }

  addPlayer(ws, id, name) {
    const teamCounts = { T: 0, CT: 0 };
    for (const p of this.players.values()) { teamCounts[p.team]++; }
    const team = teamCounts.T <= teamCounts.CT ? 'T' : 'CT';
    const spawnList = SPAWNS[team];
    const spawn = spawnList[teamCounts[team] % spawnList.length];

    const player = {
      id, name, team, ws,
      x: spawn.x, y: spawn.y,
      radius: 14,
      angle: 0,
      hp: 100, armor: 100,
      ammo: 30, ammoReserve: 90,
      dead: false,
      kills: 0, deaths: 0, hs: 0,
      money: 800,
      fireTimer: 0,
      reloading: false,
      reloadTimer: 0,
      // input state
      keys: { w: false, a: false, s: false, d: false },
      mouseAngle: 0,
      shooting: false,
    };
    this.players.set(id, player);
    return player;
  }

  removePlayer(id) {
    this.players.delete(id);
    if (this.players.size === 0) {
      this.stop();
      rooms.delete(this.code);
    }
  }

  start() {
    if (this.tickInterval) return;
    this.phase = 'playing';
    this.lastTick = Date.now();
    this.tickInterval = setInterval(() => this.tick(), 1000 / TICK_RATE);
    this.broadcast({ type: 'phase', phase: 'playing', round: this.round });
  }

  stop() {
    if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; }
  }

  tick() {
    const now = Date.now();
    const dt = Math.min((now - this.lastTick) / 1000, 0.05);
    this.lastTick = now;

    if (this.phase !== 'playing') return;

    // Round timer
    this.roundTime -= dt;
    if (this.roundTime <= 0) this.endRound('TIME');

    const speed = 220;

    for (const p of this.players.values()) {
      if (p.dead) continue;

      // Movement
      let dx = 0, dy = 0;
      if (p.keys.w) dy -= 1;
      if (p.keys.s) dy += 1;
      if (p.keys.a) dx -= 1;
      if (p.keys.d) dx += 1;
      if (dx && dy) { dx *= 0.707; dy *= 0.707; }
      p.x = clamp(p.x + dx * speed * dt, 20, WORLD_W - 20);
      p.y = clamp(p.y + dy * speed * dt, 20, WORLD_H - 20);
      resolveWalls(p);

      // Reload
      if (p.reloading) {
        p.reloadTimer -= dt;
        if (p.reloadTimer <= 0) {
          const refill = Math.min(30 - p.ammo, p.ammoReserve);
          p.ammo += refill; p.ammoReserve -= refill;
          p.reloading = false;
        }
      }

      // Shooting
      p.fireTimer = Math.max(0, p.fireTimer - dt);
      if (p.shooting && !p.reloading && p.fireTimer <= 0 && p.ammo > 0) {
        const spread = 0.06;
        const angle = p.mouseAngle + (Math.random() - 0.5) * spread;
        this.bullets.push({
          x: p.x, y: p.y,
          vx: Math.cos(angle) * 800,
          vy: Math.sin(angle) * 800,
          ownerId: p.id,
          ownerTeam: p.team,
          life: 1.5,
          damage: 22 + Math.random() * 8,
          headshot: Math.random() < 0.12,
        });
        p.ammo--;
        p.fireTimer = 0.1;
        if (p.ammo === 0 && p.ammoReserve > 0) this.reloadPlayer(p);
      }
    }

    // Bullets
    const hits = [];
    this.bullets = this.bullets.filter(b => {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0) return false;
      for (const w of WALLS) {
        if (b.x > w.x && b.x < w.x + w.w && b.y > w.y && b.y < w.y + w.h) {
          hits.push({ type: 'wallhit', x: b.x, y: b.y });
          return false;
        }
      }
      for (const target of this.players.values()) {
        if (target.dead || target.id === b.ownerId || target.team === b.ownerTeam) continue;
        const dx = b.x - target.x, dy = b.y - target.y;
        if (dx * dx + dy * dy < target.radius * target.radius) {
          let dmg = b.damage;
          if (b.headshot) dmg *= 2.4;
          if (target.armor > 0) {
            const abs = Math.min(target.armor, dmg * 0.5);
            target.armor -= abs; dmg -= abs;
          }
          target.hp -= dmg;
          const shooter = this.players.get(b.ownerId);
          hits.push({ type: 'hit', targetId: target.id, shooterId: b.ownerId, dmg: Math.floor(dmg), hs: b.headshot });

          if (target.hp <= 0) {
            target.dead = true;
            target.deaths++;
            if (shooter) {
              shooter.kills++;
              shooter.money += 300;
              if (b.headshot) shooter.hs++;
            }
            hits.push({ type: 'kill', killerId: b.ownerId, victimId: target.id, hs: b.headshot, killerName: shooter?.name || '?', victimName: target.name });
            this.checkRoundEnd();
          }
          return false;
        }
      }
      return true;
    });

    // Broadcast state
    const state = {
      type: 'state',
      t: now,
      roundTime: Math.max(0, this.roundTime),
      players: Array.from(this.players.values()).map(p => ({
        id: p.id, name: p.name, team: p.team,
        x: p.x, y: p.y, angle: p.mouseAngle,
        hp: p.hp, armor: p.armor, ammo: p.ammo, ammoReserve: p.ammoReserve,
        dead: p.dead, kills: p.kills, deaths: p.deaths, hs: p.hs,
        money: p.money, reloading: p.reloading,
      })),
      bullets: this.bullets.map(b => ({ x: b.x, y: b.y, team: b.ownerTeam })),
      hits,
      score: this.score,
    };
    this.broadcast(state);
  }

  reloadPlayer(p) {
    if (p.reloading || p.ammo >= 30 || p.ammoReserve <= 0) return;
    p.reloading = true;
    p.reloadTimer = 2.2;
  }

  checkRoundEnd() {
    const alive = { T: 0, CT: 0 };
    for (const p of this.players.values()) {
      if (!p.dead) alive[p.team]++;
    }
    if (alive.T === 0 && alive.CT === 0) { this.endRound('DRAW'); return; }
    if (alive.T === 0) { this.endRound('CT'); return; }
    if (alive.CT === 0) { this.endRound('T'); return; }
  }

  endRound(winner) {
    if (this.phase === 'roundend') return;
    this.phase = 'roundend';
    if (winner === 'T') this.score.T++;
    if (winner === 'CT') this.score.CT++;
    this.broadcast({ type: 'roundend', winner, score: this.score, round: this.round });
    setTimeout(() => this.newRound(), 4000);
  }

  newRound() {
    this.round++;
    this.roundTime = 115;
    this.bullets = [];
    for (const p of this.players.values()) {
      p.hp = 100; p.armor = 100;
      p.ammo = 30; p.ammoReserve = 90;
      p.dead = false; p.reloading = false;
      const spawnList = SPAWNS[p.team];
      const idx = [...this.players.values()].filter(q => q.team === p.team).indexOf(p);
      const spawn = spawnList[idx % spawnList.length];
      p.x = spawn.x; p.y = spawn.y;
      p.money = Math.min(16000, p.money + 1400);
    }
    this.phase = 'playing';
    this.broadcast({ type: 'newround', round: this.round, score: this.score });
  }

  broadcast(msg) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p.ws.readyState === 1) p.ws.send(data);
    }
  }

  send(id, msg) {
    const p = this.players.get(id);
    if (p && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }
}

// ─── WEBSOCKET ────────────────────────────────────────────────────
wss.on('connection', (ws) => {
  let playerId = null;
  let roomCode = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'create') {
      roomCode = uid();
      while (rooms.has(roomCode)) roomCode = uid();
      playerId = uid();
      const room = new Room(roomCode);
      rooms.set(roomCode, room);
      room.addPlayer(ws, playerId, msg.name || 'ФЕДОР');
      ws.send(JSON.stringify({ type: 'created', roomCode, playerId, walls: WALLS }));
      console.log(`[Room ${roomCode}] Created by ${playerId}`);
    }

    else if (msg.type === 'join') {
      const code = (msg.roomCode || '').toUpperCase().trim();
      const room = rooms.get(code);
      if (!room) { ws.send(JSON.stringify({ type: 'error', msg: 'Комната не найдена' })); return; }
      if (room.players.size >= 6) { ws.send(JSON.stringify({ type: 'error', msg: 'Комната заполнена' })); return; }
      roomCode = code;
      playerId = uid();
      room.addPlayer(ws, playerId, msg.name || 'Игрок');
      ws.send(JSON.stringify({ type: 'joined', roomCode, playerId, walls: WALLS, round: room.round, score: room.score }));
      room.broadcast({ type: 'playerlist', players: [...room.players.values()].map(p => ({ id: p.id, name: p.name, team: p.team })) });
      console.log(`[Room ${code}] ${playerId} joined (${room.players.size} players)`);

      // Auto-start when 2+ players join
      if (room.players.size >= 2 && room.phase === 'waiting') room.start();
    }

    else if (msg.type === 'input') {
      const room = rooms.get(roomCode);
      const player = room?.players.get(playerId);
      if (!player) return;
      if (msg.keys) player.keys = msg.keys;
      if (msg.angle !== undefined) player.mouseAngle = msg.angle;
      if (msg.shooting !== undefined) player.shooting = msg.shooting;
    }

    else if (msg.type === 'reload') {
      const room = rooms.get(roomCode);
      const player = room?.players.get(playerId);
      if (player) room.reloadPlayer(player);
    }

    else if (msg.type === 'ready') {
      const room = rooms.get(roomCode);
      if (room && room.phase === 'waiting' && room.players.size >= 1) room.start();
    }
  });

  ws.on('close', () => {
    if (roomCode && playerId) {
      const room = rooms.get(roomCode);
      if (room) {
        room.removePlayer(playerId);
        room.broadcast({ type: 'playerleft', playerId });
        console.log(`[Room ${roomCode}] ${playerId} left`);
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎮 МОЙТОХОНОВ ФЕДОР running on port ${PORT}`));
