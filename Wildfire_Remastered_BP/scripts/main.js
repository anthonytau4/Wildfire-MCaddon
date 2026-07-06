import { world, system } from "@minecraft/server";

const WILDFIRE_ID = "wildfire:wildfire";
const MAX_SHIELDS = 12;
const MAX_HP = 300;
const ARMOR_IDS = [
  "wildfire:wildfire_helmet",
  "wildfire:wildfire_chestplate",
  "wildfire:wildfire_leggings",
  "wildfire:wildfire_boots"
];

// Phase thresholds (percentage of max HP)
const PHASE_2_THRESHOLD = 0.66;
const PHASE_3_THRESHOLD = 0.33;

// Per-entity state
const state = new Map();

// --- Utility helpers ---
function safe(fn, fallback = undefined) {
  try { return fn(); } catch { return fallback; }
}
function isWildfire(e) {
  return e && e.typeId === WILDFIRE_ID && e.isValid !== false;
}
function key(e) {
  return e?.id ?? `${Math.floor(e.location.x)}:${Math.floor(e.location.y)}:${Math.floor(e.location.z)}`;
}
function st(e) {
  const k = key(e);
  if (!state.has(k)) {
    state.set(k, {
      shieldHits: MAX_SHIELDS,
      phase: 1,
      lastHit: -999999,
      lastFireball: -999999,
      lastStomp: -999999,
      lastSummon: -999999,
      lastAmbient: -999999,
      lastRegen: -999999,
      lastTeleport: -999999,
      teleportCharging: false,
      teleportChargeTick: 0,
      teleportTarget: null,
      armorActive: false,
      armorStart: -999999,
      phaseTransition: false,
      phaseTransitionTick: 0,
      driftOffset: 0
    });
  }
  return state.get(k);
}

// --- Component helpers ---
function setShield(e, v) {
  const s = st(e);
  s.shieldHits = Math.max(0, Math.min(MAX_SHIELDS, v));
  safe(() => e.triggerEvent(`wildfire:set_shield_${s.shieldHits}`));
}

function healthComp(e) {
  return safe(() => e.getComponent("minecraft:health")) ?? safe(() => e.getComponent("health"));
}

function getHP(e) {
  const h = healthComp(e);
  return h ? (h.currentValue ?? 0) : 0;
}

function getMaxHP(e) {
  const h = healthComp(e);
  return h ? (h.effectiveMax ?? h.defaultValue ?? MAX_HP) : MAX_HP;
}

function heal(e, n) {
  const h = healthComp(e);
  if (!h || typeof h.setCurrentValue !== "function") return;
  const max = getMaxHP(e);
  const cur = h.currentValue ?? max;
  safe(() => h.setCurrentValue(Math.min(max, cur + n)));
}

function play(e, id, pitch = 1, volume = 1) {
  safe(() => e.dimension.playSound(id, e.location, { pitch, volume }));
}

function pAt(e, id, loc) {
  safe(() => e.dimension.spawnParticle(id, loc));
}

function p(e, id, dx = 0, dy = 1.25, dz = 0) {
  pAt(e, id, { x: e.location.x + dx, y: e.location.y + dy, z: e.location.z + dz });
}

function norm(dx, dy, dz) {
  const l = Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz));
  return { x: dx / l, y: dy / l, z: dz / l };
}

// --- Phase system ---
function getPhase(e) {
  const hpPct = getHP(e) / getMaxHP(e);
  if (hpPct <= PHASE_3_THRESHOLD) return 3;
  if (hpPct <= PHASE_2_THRESHOLD) return 2;
  return 1;
}

function phaseMultiplier(phase) {
  // Scales difficulty per phase
  return phase === 1 ? 1.0 : phase === 2 ? 1.4 : 1.85;
}

function enterPhase(e, newPhase) {
  const s = st(e);
  if (s.phaseTransition) return;
  s.phase = newPhase;
  s.phaseTransition = true;
  s.phaseTransitionTick = system.currentTick ?? 0;

  // Set entity property for client-side visuals
  safe(() => e.setProperty("wildfire:phase", newPhase));
  safe(() => e.triggerEvent(`wildfire:enter_phase_${newPhase}`));

  // Fully regenerate shields
  setShield(e, MAX_SHIELDS);

  // Dramatic transition effects
  play(e, "mob.wither.spawn", 0.6, 2.0);
  play(e, "random.explode", 1.0, 1.5);
  play(e, "mob.blaze.breathe", 0.4, 2.0);

  // Massive particle burst
  for (let i = 0; i < 60; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 0.5 + Math.random() * 3.5;
    const dy = Math.random() * 3.5;
    p(e, "minecraft:lava_particle", Math.cos(a) * r, dy, Math.sin(a) * r);
    p(e, "minecraft:basic_flame_particle", Math.cos(a) * r, dy, Math.sin(a) * r);
  }
  for (let i = 0; i < 20; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * 2;
    p(e, "minecraft:basic_smoke_particle", Math.cos(a) * r, 1 + Math.random() * 2, Math.sin(a) * r);
  }

  // Knockback nearby players
  const loc = e.location;
  for (const pl of world.getPlayers()) {
    if (pl.dimension.id !== e.dimension.id) continue;
    const l = pl.location;
    const dx = l.x - loc.x, dy = l.y - loc.y, dz = l.z - loc.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 <= 64) {
      const d = norm(dx, 0, dz);
      safe(() => pl.applyKnockback(d.x, d.z, 2.0, 0.65));
    }
  }

  // End transition after 2 seconds
  system.runTimeout(() => {
    if (isWildfire(e)) {
      s.phaseTransition = false;
    }
  }, 40);
}

// --- Particle effects ---
function burst(e, strong = false) {
  const ids = ["minecraft:basic_flame_particle", "minecraft:lava_particle", "minecraft:basic_smoke_particle"];
  const count = strong ? 42 : 16;
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = (strong ? 0.45 : 0.25) + Math.random() * (strong ? 3.1 : 1.7);
    p(e, ids[i % ids.length], Math.cos(a) * r, 0.35 + Math.random() * 2.5, Math.sin(a) * r);
  }
}

function shieldBreakEffect(e, shieldIndex) {
  const angle = (shieldIndex / 4) * Math.PI * 2;
  const x = Math.cos(angle) * 1.65, z = Math.sin(angle) * 1.65;
  for (let i = 0; i < 28; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.75;
    p(e, "minecraft:lava_particle", x + Math.cos(a) * r, 1.25 + Math.random() * 1.2, z + Math.sin(a) * r);
    p(e, "minecraft:basic_flame_particle", x + Math.cos(a) * r, 1.25 + Math.random() * 1.2, z + Math.sin(a) * r);
  }
  // Anvil break sound for shield destruction
  play(e, "random.anvil_break", 1.2, 1.5);
  play(e, "mob.blaze.hit", 0.72, 1.6);
}

// --- Teleportation ---
function teleportSwirl(e) {
  // Swirling particles around the wildfire before teleport
  const tick = system.currentTick ?? 0;
  const s = st(e);
  const progress = (tick - s.teleportChargeTick) / 40; // 2 seconds charge
  for (let i = 0; i < 6; i++) {
    const angle = (tick * 0.2 + i * (Math.PI * 2 / 6)) % (Math.PI * 2);
    const r = 1.5 - progress * 0.8; // Spiral inward
    const dy = (i * 0.4) % 2.5;
    p(e, "minecraft:portal_directional", Math.cos(angle) * r, 0.5 + dy, Math.sin(angle) * r);
    p(e, "minecraft:basic_flame_particle", Math.cos(angle) * r * 0.8, 0.3 + dy, Math.sin(angle) * r * 0.8);
  }
}

function tryTeleport(e, target, tick) {
  const s = st(e);
  const phase = s.phase;
  const cooldown = phase === 1 ? 300 : phase === 2 ? 200 : 140; // Shorter cooldown in later phases

  if (tick - s.lastTeleport < cooldown) return;
  if (target.dist < 5 || target.dist > 30) return;
  if (s.teleportCharging) return;

  // Start charging
  s.teleportCharging = true;
  s.teleportChargeTick = tick;
  s.teleportTarget = {
    x: target.player.location.x,
    y: target.player.location.y,
    z: target.player.location.z
  };

  play(e, "mob.endermen.portal", 0.7, 0.8);

  // Execute teleport after charge time (2 seconds)
  system.runTimeout(() => {
    if (!isWildfire(e)) { s.teleportCharging = false; return; }

    // Find a valid position near where the target WAS
    const dest = s.teleportTarget;
    if (!dest) { s.teleportCharging = false; return; }

    // Try to teleport near the target, offset randomly
    const offAngle = Math.random() * Math.PI * 2;
    const offDist = 3 + Math.random() * 3;
    const tx = dest.x + Math.cos(offAngle) * offDist;
    const tz = dest.z + Math.sin(offAngle) * offDist;
    const ty = dest.y + 1;

    // checkForBlocks prevents teleporting through walls
    const success = safe(() => {
      e.teleport({ x: tx, y: ty, z: tz }, { dimension: e.dimension, checkForBlocks: true });
      return true;
    }, false);

    if (success) {
      s.lastTeleport = system.currentTick ?? 0;
      // Arrival effects
      play(e, "mob.endermen.portal", 1.0, 1.2);
      play(e, "mob.blaze.shoot", 0.5, 1.5);
      burst(e, true);
      for (let i = 0; i < 15; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 2;
        p(e, "minecraft:portal_directional", Math.cos(a) * r, Math.random() * 2.5, Math.sin(a) * r);
      }
    }

    s.teleportCharging = false;
    s.teleportTarget = null;
  }, 40);
}

// --- Wither-like armor regeneration ---
function updateArmor(e, tick) {
  const s = st(e);
  const timeSinceHit = tick - s.lastHit;
  const shouldArmor = s.shieldHits < MAX_SHIELDS && timeSinceHit > 100;

  if (shouldArmor && !s.armorActive) {
    s.armorActive = true;
    s.armorStart = tick;
    safe(() => e.setProperty("wildfire:is_armored", true));
    play(e, "mob.wither.ambient", 1.2, 0.6);
  } else if (!shouldArmor && s.armorActive) {
    s.armorActive = false;
    safe(() => e.setProperty("wildfire:is_armored", false));
  }

  // While armored, regenerate health slowly
  if (s.armorActive && tick - s.lastRegen >= 40) {
    s.lastRegen = tick;
    const phase = s.phase;
    const healAmt = phase === 1 ? 2 : phase === 2 ? 3 : 4;
    heal(e, healAmt);

    // Grey smoke particles during regen
    for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.5 + Math.random() * 0.8;
      p(e, "minecraft:basic_smoke_particle", Math.cos(a) * r, 0.5 + Math.random() * 2, Math.sin(a) * r);
    }
  }
}

// --- Shield regeneration ---
function regenShields(e, tick) {
  const s = st(e);
  if (s.shieldHits >= MAX_SHIELDS) return;

  const canRegen = tick - s.lastHit > 180 || fireOrLavaNear(e);
  const regenRate = s.phase === 1 ? 80 : s.phase === 2 ? 60 : 45;

  if (canRegen && tick - s.lastRegen >= regenRate) {
    s.lastRegen = tick;
    setShield(e, s.shieldHits + 1);
    heal(e, 1);
    burst(e, false);
    play(e, "mob.blaze.hit", 1.45, 0.75);
  }
}

// --- Combat ---
function equipId(player, slot) {
  const eq = safe(() => player.getComponent("minecraft:equippable")) ?? safe(() => player.getComponent("equippable"));
  if (!eq) return "";
  return safe(() => eq.getEquipment(slot)?.typeId, "") ?? "";
}

function armorCount(player) {
  let c = 0;
  for (const slot of ["Head", "Chest", "Legs", "Feet"])
    if (ARMOR_IDS.includes(equipId(player, slot))) c++;
  return c;
}

function updatePlayerArmor(tick) {
  for (const player of world.getPlayers()) {
    const count = armorCount(player);
    if (count > 0) safe(() => player.addTag("wildfire_friend"));
    else safe(() => player.removeTag("wildfire_friend"));
    const hostileUntil = Number(safe(() => player.getDynamicProperty("wildfire_hostile_until"), 0) ?? 0);
    if (hostileUntil > tick) safe(() => player.addTag("wildfire_hostile"));
    else safe(() => player.removeTag("wildfire_hostile"));
    if (count >= 4) safe(() => player.addEffect("fire_resistance", 80, { amplifier: 0, showParticles: false }));
  }
}

function targetAllowed(player, tick) {
  const hostileUntil = Number(safe(() => player.getDynamicProperty("wildfire_hostile_until"), 0) ?? 0);
  if (armorCount(player) > 0 && hostileUntil <= tick) return false;
  return true;
}

function nearestPlayer(e, max, tick) {
  let best = undefined, bestD2 = max * max, loc = e.location;
  for (const pl of world.getPlayers()) {
    if (pl.dimension.id !== e.dimension.id) continue;
    if (!targetAllowed(pl, tick)) continue;
    const l = pl.location, dx = l.x - loc.x, dy = l.y - loc.y, dz = l.z - loc.z, d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) { bestD2 = d2; best = { player: pl, dx, dy, dz, dist: Math.sqrt(d2) }; }
  }
  return best;
}

function markHostile(player, tick) {
  if (player?.typeId === "minecraft:player") {
    safe(() => player.setDynamicProperty("wildfire_hostile_until", tick + 1200));
    safe(() => player.addTag("wildfire_hostile"));
  }
}

function particleLine(e, from, dir, len) {
  for (let i = 1; i <= 10; i++) {
    const t = (i / 10) * len;
    pAt(e, "minecraft:basic_flame_particle", { x: from.x + dir.x * t, y: from.y + dir.y * t, z: from.z + dir.z * t });
  }
}

function shootOne(e, target, spread) {
  const start = { x: e.location.x, y: e.location.y + 1.55, z: e.location.z };
  const end = { x: target.player.location.x, y: target.player.location.y + 1.15, z: target.player.location.z };
  let dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
  const yaw = Math.atan2(dz, dx) + spread;
  const flat = Math.sqrt(dx * dx + dz * dz);
  dx = Math.cos(yaw) * flat;
  dz = Math.sin(yaw) * flat;
  const dir = norm(dx, dy, dz);
  particleLine(e, start, dir, Math.min(14, Math.max(5, target.dist)));
  const fireball = safe(() => e.dimension.spawnEntity("minecraft:small_fireball", start));
  if (fireball) {
    const proj = safe(() => fireball.getComponent("minecraft:projectile")) ?? safe(() => fireball.getComponent("projectile"));
    if (proj && typeof proj.shoot === "function")
      safe(() => proj.shoot({ x: dir.x * 1.45, y: dir.y * 1.45, z: dir.z * 1.45 }));
    else
      safe(() => fireball.applyImpulse({ x: dir.x * 1.15, y: dir.y * 1.15, z: dir.z * 1.15 }));
  }
  if (target.dist <= 16) {
    const dmg = Math.floor(2 * phaseMultiplier(st(e).phase));
    safe(() => target.player.applyDamage(dmg, { cause: "fire", damagingEntity: e }));
    safe(() => target.player.setOnFire(3, true));
  }
}

function fireballShotgun(e, target, tick) {
  const s = st(e);
  const phase = s.phase;
  const cooldown = phase === 1 ? 60 : phase === 2 ? 42 : 28;
  if (tick - s.lastFireball < cooldown) return;
  s.lastFireball = tick;

  play(e, "mob.blaze.shoot", 0.78, 1.9);
  burst(e, false);

  // More projectiles in later phases
  const spreads = phase === 1
    ? [-0.25, -0.12, 0, 0.12, 0.25]
    : phase === 2
      ? [-0.30, -0.18, -0.06, 0.06, 0.18, 0.30]
      : [-0.35, -0.23, -0.12, 0, 0.12, 0.23, 0.35];

  for (const spread of spreads) shootOne(e, target, spread);
}

function stomp(e, target, tick) {
  const s = st(e);
  const phase = s.phase;
  const cooldown = phase === 1 ? 170 : phase === 2 ? 120 : 80;
  if (tick - s.lastStomp < cooldown || target.dist > 9) return;
  s.lastStomp = tick;

  play(e, "mob.blaze.breathe", 0.5, 1.9);
  play(e, "mob.blaze.shoot", 0.45, 1.7);
  burst(e, true);

  const landing = { x: target.player.location.x, y: target.player.location.y + 1.0, z: target.player.location.z };
  safe(() => e.teleport(
    { x: e.location.x, y: e.location.y + 4.5, z: e.location.z },
    { dimension: e.dimension, checkForBlocks: false }
  ));

  system.runTimeout(() => {
    if (!isWildfire(e)) return;
    safe(() => e.teleport(landing, { dimension: e.dimension, checkForBlocks: false }));
    play(e, "mob.blaze.shoot", 0.33, 2.0);
    play(e, "random.explode", 1.2, 0.75);
    burst(e, true);

    const stompDmg = Math.floor(10 * phaseMultiplier(phase));
    const stompRadius = phase === 1 ? 30.25 : phase === 2 ? 42.25 : 56.25;
    const loc = e.location;
    for (const pl of world.getPlayers()) {
      if (pl.dimension.id !== e.dimension.id) continue;
      const l = pl.location, dx = l.x - loc.x, dy = l.y - loc.y, dz = l.z - loc.z;
      if (dx * dx + dy * dy + dz * dz <= stompRadius) {
        safe(() => pl.applyDamage(stompDmg, { cause: "fire", damagingEntity: e }));
        safe(() => pl.setOnFire(5, true));
        const d = norm(dx, 0, dz);
        safe(() => pl.applyKnockback(d.x, d.z, 1.25, 0.55));
      }
    }
  }, 16);
}

function summonBlazes(e, target, tick) {
  const s = st(e);
  const phase = s.phase;
  const cooldown = phase === 1 ? 400 : phase === 2 ? 280 : 180;
  if (tick - s.lastSummon < cooldown) return;
  if (Math.random() > 0.2 && s.shieldHits > 0) return;

  const maxBlazes = phase === 1 ? 6 : phase === 2 ? 8 : 10;
  const existing = safe(() => e.dimension.getEntities({ type: "minecraft:blaze", location: e.location, maxDistance: 24 }), []);
  if (existing.length >= maxBlazes) return;

  s.lastSummon = tick;
  const amount = phase === 1 ? 2 + Math.floor(Math.random() * 2) : phase === 2 ? 3 + Math.floor(Math.random() * 2) : 4 + Math.floor(Math.random() * 3);

  play(e, "mob.blaze.breathe", 0.48, 1.8);
  burst(e, true);

  for (let i = 0; i < amount; i++) {
    const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 2.5;
    safe(() => e.dimension.spawnEntity("minecraft:blaze", {
      x: e.location.x + Math.cos(a) * r,
      y: e.location.y + 0.5,
      z: e.location.z + Math.sin(a) * r
    }));
  }
}

function fireOrLavaNear(e) {
  const l = e.location;
  const checks = [[0, 0, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
    [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1]];
  for (const c of checks) {
    const b = safe(() => e.dimension.getBlock({
      x: Math.floor(l.x + c[0]),
      y: Math.floor(l.y + c[1]),
      z: Math.floor(l.z + c[2])
    }));
    const id = b?.typeId ?? "";
    if (id.includes("fire") || id.includes("lava") || id.includes("magma")) return true;
  }
  return false;
}

// --- Downward drift (blaze-like slow descent) ---
function applyDrift(e) {
  const s = st(e);
  const loc = e.location;
  // Gently push downward unless very close to ground
  const blockBelow = safe(() => e.dimension.getBlock({
    x: Math.floor(loc.x),
    y: Math.floor(loc.y - 1),
    z: Math.floor(loc.z)
  }));
  const isAir = !blockBelow || blockBelow.typeId === "minecraft:air" || blockBelow.typeId === "minecraft:cave_air";
  if (isAir && loc.y > 1) {
    // Slow downward impulse like a blaze gently drifting down
    safe(() => e.applyImpulse({ x: 0, y: -0.018, z: 0 }));
  }
}

// --- Ambient effects per phase ---
function ambientEffects(e, tick) {
  const s = st(e);
  if (tick - s.lastAmbient < 70) return;
  s.lastAmbient = tick;

  play(e, "mob.blaze.breathe", 0.85 + Math.random() * 0.25, 0.65);
  p(e, "minecraft:basic_flame_particle", 0, 1.45, 0);

  // Phase-specific ambient particles
  if (s.phase >= 2) {
    for (let i = 0; i < 3; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.3 + Math.random() * 0.5;
      p(e, "minecraft:lava_particle", Math.cos(a) * r, 0.5 + Math.random() * 2, Math.sin(a) * r);
    }
  }
  if (s.phase >= 3) {
    for (let i = 0; i < 5; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.5 + Math.random() * 1.0;
      p(e, "minecraft:basic_smoke_particle", Math.cos(a) * r, Math.random() * 3, Math.sin(a) * r);
      p(e, "minecraft:basic_flame_particle", Math.cos(a) * r * 0.5, Math.random() * 2.5, Math.sin(a) * r * 0.5);
    }
  }
}

// --- Entity scanning ---
function scan(callback) {
  for (const id of ["overworld", "nether", "the_end"]) {
    const dim = safe(() => world.getDimension(id));
    if (!dim) continue;
    const mobs = safe(() => dim.getEntities({ type: WILDFIRE_ID }), []);
    for (const e of mobs) if (isWildfire(e)) callback(e);
  }
}

// --- Shield hit with anvil break ---
function shieldHit(e, next) {
  setShield(e, next);
  // Every individual shield in a group of 3 breaking
  if (next % 3 === 0) {
    // Full shield panel broken
    shieldBreakEffect(e, Math.floor(next / 3));
  } else {
    burst(e, false);
    play(e, "random.anvil_land", 1.4, 0.8);
    play(e, "mob.blaze.hit", 0.78, 1.25);
  }
}

// --- Event subscriptions ---
safe(() => world.afterEvents.entitySpawn.subscribe((event) => {
  if (isWildfire(event.entity)) {
    setShield(event.entity, MAX_SHIELDS);
    burst(event.entity, true);
    play(event.entity, "mob.blaze.breathe", 0.65, 1.8);
    safe(() => event.entity.setProperty("wildfire:phase", 1));
    safe(() => event.entity.setProperty("wildfire:is_armored", false));
    safe(() => event.entity.triggerEvent("wildfire:enter_phase_1"));
  }
}));

safe(() => world.beforeEvents.entityHurt.subscribe((event) => {
  const e = event.hurtEntity, tick = system.currentTick ?? 0;
  if (!isWildfire(e)) return;
  const s = st(e);
  s.lastHit = tick;
  markHostile(event.damageSource?.damagingEntity, tick);
  const cause = String(event.damageSource?.cause ?? "").toLowerCase();
  if (s.shieldHits > 0 && !cause.includes("fire") && !cause.includes("lava") && !cause.includes("fall")) {
    event.cancel = true;
    system.run(() => {
      if (isWildfire(e)) shieldHit(e, s.shieldHits - 1);
    });
  }
}));

safe(() => world.afterEvents.entityHurt.subscribe((event) => {
  const e = event.hurtEntity, tick = system.currentTick ?? 0;
  if (!isWildfire(e)) return;
  const s = st(e);
  markHostile(event.damageSource?.damagingEntity, tick);
  const cause = String(event.damageSource?.cause ?? "").toLowerCase();
  if (s.shieldHits > 0 && !cause.includes("fire") && !cause.includes("lava") && !cause.includes("fall")) {
    heal(e, event.damage ?? 0);
    shieldHit(e, s.shieldHits - 1);
  }
}));

// --- Main game loop ---
system.runInterval(() => {
  const tick = system.currentTick ?? 0;
  updatePlayerArmor(tick);

  scan((e) => {
    const s = st(e);

    // Sync shield visual
    safe(() => e.triggerEvent(`wildfire:set_shield_${s.shieldHits}`));

    // Phase check
    const expectedPhase = getPhase(e);
    if (expectedPhase > s.phase && !s.phaseTransition) {
      enterPhase(e, expectedPhase);
    }

    // Blaze-like drift downward
    applyDrift(e);

    // Ambient effects
    ambientEffects(e, tick);

    // Wither armor regen
    updateArmor(e, tick);

    // Shield regen
    regenShields(e, tick);

    // Teleport charging particles
    if (s.teleportCharging) {
      teleportSwirl(e);
    }

    // Combat
    const target = nearestPlayer(e, 36, tick);
    if (!target) return;

    // Don't attack during phase transition
    if (s.phaseTransition) return;

    fireballShotgun(e, target, tick);
    stomp(e, target, tick);
    summonBlazes(e, target, tick);

    // Teleport (phase 2+ or when shields are down)
    if (s.phase >= 2 || s.shieldHits === 0) {
      tryTeleport(e, target, tick);
    }
  });
}, 10);
