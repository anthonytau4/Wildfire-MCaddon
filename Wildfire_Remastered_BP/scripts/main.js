import { world, system } from "@minecraft/server";

const WILDFIRE_ID = "wildfire:wildfire";
const MAX_SHIELD_HITS = 12;
const REGEN_AFTER_TICKS = 180;
const ARMOR_IDS = [
  "wildfire:wildfire_helmet",
  "wildfire:wildfire_chestplate",
  "wildfire:wildfire_leggings",
  "wildfire:wildfire_boots"
];

const state = new Map();

function safe(fn, fallback = undefined) {
  try { return fn(); } catch (e) { return fallback; }
}

function isWildfire(entity) {
  return entity && entity.typeId === WILDFIRE_ID;
}

function key(entity) {
  return entity?.id ?? `${Math.floor(entity.location.x)}:${Math.floor(entity.location.y)}:${Math.floor(entity.location.z)}`;
}

function getState(entity) {
  const id = key(entity);
  if (!state.has(id)) {
    state.set(id, {
      shieldHits: MAX_SHIELD_HITS,
      lastDamaged: -99999,
      lastFireball: -99999,
      lastSummon: -99999,
      lastStomp: -99999,
      lastAmbient: -99999,
      angryUntil: 0
    });
    safe(() => entity.triggerEvent("wildfire:set_shield_12"));
  }
  return state.get(id);
}

function setShieldHits(entity, value) {
  const st = getState(entity);
  st.shieldHits = Math.max(0, Math.min(MAX_SHIELD_HITS, value));
  safe(() => entity.triggerEvent(`wildfire:set_shield_${st.shieldHits}`));
}

function getHealth(entity) {
  return safe(() => entity.getComponent("minecraft:health"), undefined) ?? safe(() => entity.getComponent("health"), undefined);
}

function heal(entity, amount) {
  const h = getHealth(entity);
  if (!h || typeof h.setCurrentValue !== "function") return;
  const max = h.effectiveMax ?? h.defaultValue ?? 220;
  const cur = h.currentValue ?? max;
  safe(() => h.setCurrentValue(Math.min(max, cur + amount)));
}

function play(entity, sound, pitch = 1.0, volume = 1.0) {
  safe(() => entity.dimension.playSound(sound, entity.location, { pitch, volume }));
}

function particle(entity, particleId, dx = 0, dy = 1.2, dz = 0) {
  safe(() => entity.dimension.spawnParticle(particleId, {
    x: entity.location.x + dx,
    y: entity.location.y + dy,
    z: entity.location.z + dz
  }));
}

function burst(entity, strong = false) {
  const count = strong ? 32 : 12;
  const parts = ["minecraft:basic_flame_particle", "minecraft:lava_particle", "minecraft:basic_smoke_particle"];
  for (let i = 0; i < count; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = (strong ? 0.45 : 0.25) + Math.random() * (strong ? 2.9 : 1.5);
    particle(entity, parts[i % parts.length], Math.cos(a) * r, 0.35 + Math.random() * 2.4, Math.sin(a) * r);
  }
}

function getEquippable(player) {
  return safe(() => player.getComponent("minecraft:equippable"), undefined) ?? safe(() => player.getComponent("equippable"), undefined);
}

function equipmentType(player, slot) {
  const eq = getEquippable(player);
  if (!eq) return "";
  const item = safe(() => eq.getEquipment(slot), undefined);
  return item?.typeId ?? "";
}

function armorCount(player) {
  let count = 0;
  const slots = ["Head", "Chest", "Legs", "Feet"];
  for (const slot of slots) {
    if (ARMOR_IDS.includes(equipmentType(player, slot))) count++;
  }
  return count;
}

function hasAnyWildfireArmor(player) {
  return armorCount(player) > 0;
}

function hasFullWildfireArmor(player) {
  return armorCount(player) === 4;
}

function updatePlayerArmorTagsAndEffects(tick) {
  for (const player of world.getPlayers()) {
    const any = hasAnyWildfireArmor(player);
    const full = hasFullWildfireArmor(player);

    if (any) safe(() => player.addTag("wildfire_friend"));
    else safe(() => player.removeTag("wildfire_friend"));

    const hostileUntil = Number(safe(() => player.getDynamicProperty("wildfire_hostile_until"), 0) ?? 0);
    if (hostileUntil > tick) safe(() => player.addTag("wildfire_hostile"));
    else safe(() => player.removeTag("wildfire_hostile"));

    if (full) safe(() => player.addEffect("fire_resistance", 60, { amplifier: 0, showParticles: false }));
  }
}

function isPlayerValidTarget(player, tick) {
  if (!player || player.typeId !== "minecraft:player") return false;
  const hostileUntil = Number(safe(() => player.getDynamicProperty("wildfire_hostile_until"), 0) ?? 0);
  if (hasAnyWildfireArmor(player) && hostileUntil <= tick) return false;
  return true;
}

function nearestTarget(entity, maxDistance, tick) {
  let best = undefined;
  let bestD2 = maxDistance * maxDistance;
  const loc = entity.location;
  for (const p of world.getPlayers()) {
    if (p.dimension.id !== entity.dimension.id) continue;
    if (!isPlayerValidTarget(p, tick)) continue;
    const pl = p.location;
    const dx = pl.x - loc.x;
    const dy = pl.y - loc.y;
    const dz = pl.z - loc.z;
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 < bestD2) {
      bestD2 = d2;
      best = { player: p, dx, dy, dz, dist: Math.sqrt(d2) };
    }
  }
  return best;
}

function spawnFireball(entity, target, spreadRadians) {
  const loc = entity.location;
  const targetLoc = target.player.location;
  const start = {
    x: loc.x,
    y: loc.y + 1.55,
    z: loc.z
  };

  let dx = targetLoc.x - start.x;
  let dy = (targetLoc.y + 1.15) - start.y;
  let dz = targetLoc.z - start.z;
  const flat = Math.atan2(dz, dx) + spreadRadians;
  const horiz = Math.sqrt(dx * dx + dz * dz);
  dx = Math.cos(flat) * horiz;
  dz = Math.sin(flat) * horiz;

  const len = Math.max(0.001, Math.sqrt(dx * dx + dy * dy + dz * dz));
  const vx = dx / len;
  const vy = dy / len;
  const vz = dz / len;

  const fireball = safe(() => entity.dimension.spawnEntity("minecraft:small_fireball", start), undefined);
  if (fireball) {
    safe(() => fireball.applyImpulse({ x: vx * 1.25, y: vy * 1.25, z: vz * 1.25 }));
  }
}

function fireballShotgun(entity, target, tick) {
  const st = getState(entity);
  if (tick - st.lastFireball < 60) return;
  st.lastFireball = tick;

  play(entity, "mob.blaze.shoot", 0.85, 1.7);
  burst(entity, false);

  const spreads = [-0.24, -0.12, 0, 0.12, 0.24];
  for (const spread of spreads) spawnFireball(entity, target, spread);
}

function stomp(entity, target, tick) {
  const st = getState(entity);
  if (tick - st.lastStomp < 180) return;
  if (target.dist > 8.5) return;
  st.lastStomp = tick;

  play(entity, "mob.blaze.breathe", 0.55, 1.8);
  play(entity, "mob.blaze.shoot", 0.45, 1.6);
  burst(entity, true);

  const landing = { x: target.player.location.x, y: target.player.location.y + 1.1, z: target.player.location.z };

  safe(() => entity.teleport({ x: entity.location.x, y: entity.location.y + 4.5, z: entity.location.z }, { dimension: entity.dimension, checkForBlocks: false }));

  system.runTimeout(() => {
    if (!entity || !entity.isValid) return;
    safe(() => entity.teleport(landing, { dimension: entity.dimension, checkForBlocks: false }));
    play(entity, "mob.blaze.shoot", 0.35, 1.9);
    play(entity, "random.explode", 1.25, 0.8);
    burst(entity, true);

    const loc = entity.location;
    for (const player of world.getPlayers()) {
      if (player.dimension.id !== entity.dimension.id) continue;
      const p = player.location;
      const dx = p.x - loc.x, dy = p.y - loc.y, dz = p.z - loc.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 <= 25) {
        safe(() => player.applyDamage(9, { cause: "fire", damagingEntity: entity }));
        safe(() => player.setOnFire(5, true));
        const len = Math.max(0.001, Math.sqrt(dx * dx + dz * dz));
        safe(() => player.applyImpulse({ x: (dx / len) * 1.15, y: 0.55, z: (dz / len) * 1.15 }));
      }
    }
  }, 16);
}

function summonBlazes(entity, target, tick) {
  const st = getState(entity);
  if (tick - st.lastSummon < 420) return;
  if (Math.random() > 0.18 && st.shieldHits > 0) return;

  const existing = safe(() => entity.dimension.getEntities({ type: "minecraft:blaze", location: entity.location, maxDistance: 24 }), []);
  if (existing.length >= 6) return;

  st.lastSummon = tick;
  const amount = 2 + Math.floor(Math.random() * 2);
  play(entity, "mob.blaze.breathe", 0.5, 1.8);
  burst(entity, true);

  for (let i = 0; i < amount; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 2.5 + Math.random() * 2.5;
    safe(() => entity.dimension.spawnEntity("minecraft:blaze", {
      x: entity.location.x + Math.cos(a) * r,
      y: entity.location.y + 0.4,
      z: entity.location.z + Math.sin(a) * r
    }));
  }
}

function fireOrLavaNear(entity) {
  const dim = entity.dimension;
  const p = entity.location;
  const checks = [
    [0,0,0], [0,-1,0], [1,0,0], [-1,0,0], [0,0,1], [0,0,-1],
    [1,-1,0], [-1,-1,0], [0,-1,1], [0,-1,-1]
  ];
  for (const c of checks) {
    const block = safe(() => dim.getBlock({ x: Math.floor(p.x + c[0]), y: Math.floor(p.y + c[1]), z: Math.floor(p.z + c[2]) }), undefined);
    const id = block?.typeId ?? "";
    if (id.includes("fire") || id.includes("lava") || id.includes("magma")) return true;
  }
  return false;
}

function scanWildfires(callback) {
  for (const id of ["overworld", "nether", "the_end"]) {
    const dim = safe(() => world.getDimension(id), undefined);
    if (!dim) continue;
    const mobs = safe(() => dim.getEntities({ type: WILDFIRE_ID }), []);
    for (const mob of mobs) callback(mob);
  }
}

safe(() => world.afterEvents.entitySpawn.subscribe((event) => {
  const entity = event.entity;
  if (isWildfire(entity)) {
    setShieldHits(entity, MAX_SHIELD_HITS);
    burst(entity, true);
    play(entity, "mob.blaze.breathe", 0.65, 1.7);
  }
}));

safe(() => world.beforeEvents.entityHurt.subscribe((event) => {
  const hurt = event.hurtEntity;
  const damager = event.damageSource?.damagingEntity;
  const tick = system.currentTick ?? 0;

  if (isWildfire(hurt)) {
    const st = getState(hurt);
    st.lastDamaged = tick;

    if (damager?.typeId === "minecraft:player") {
      safe(() => damager.setDynamicProperty("wildfire_hostile_until", tick + 1200));
      safe(() => damager.addTag("wildfire_hostile"));
    }

    const cause = String(event.damageSource?.cause ?? "").toLowerCase();
    if (st.shieldHits > 0 && !cause.includes("fire") && !cause.includes("lava") && !cause.includes("fall")) {
      event.cancel = true;
      system.run(() => {
        if (!hurt || !hurt.isValid) return;
        setShieldHits(hurt, st.shieldHits - 1);
        burst(hurt, false);
        play(hurt, "mob.blaze.hit", 0.78, 1.5);
        if ((st.shieldHits % 3) === 0) play(hurt, "random.anvil_land", 1.65, 0.5);
      });
    }
  }
}));

system.runInterval(() => {
  const tick = system.currentTick ?? 0;
  updatePlayerArmorTagsAndEffects(tick);

  scanWildfires((entity) => {
    const st = getState(entity);

    if (tick - st.lastAmbient > 80) {
      st.lastAmbient = tick;
      play(entity, "mob.blaze.breathe", 0.85 + Math.random() * 0.25, 0.75);
      particle(entity, "minecraft:basic_flame_particle", 0, 1.4, 0);
    }

    if ((tick - st.lastDamaged > REGEN_AFTER_TICKS || fireOrLavaNear(entity)) && st.shieldHits < MAX_SHIELD_HITS && tick % 60 === 0) {
      setShieldHits(entity, st.shieldHits + 1);
      heal(entity, 1);
      burst(entity, false);
      play(entity, "mob.blaze.hit", 1.45, 0.8);
    }

    const target = nearestTarget(entity, 34, tick);
    if (!target) return;

    fireballShotgun(entity, target, tick);
    stomp(entity, target, tick);
    summonBlazes(entity, target, tick);
  });
}, 10);
