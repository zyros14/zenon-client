// ===== Skin animation: superhero float =====
// Organic, alive-feeling idle with overlapping action through the ENTIRE
// model: head leads turns, body follows, limbs trail, cape whips last and
// biggest. Every bone moves; nothing is locked in sync.
//
// Principles:
//   - Whip-chain: head → body → arms/legs → cape, each softer/slower than the last
//   - Secondary motion: cape swings off the bob, knees absorb float rise/fall
//   - Breath drives the chest, shoulders, and collar independently
//   - Weight transfer always runs between the two legs
//   - Micro-saccades: quick head flicks, separate from idle gestures
//   - Random gestures layer on top and fade in/out
import { FunctionAnimation } from 'skinview3d';

// ---- Smooth pseudo-noise: sum of incommensurate sines. Organic, never loops.
//-----------------------------------------------------------------------------
function noise(t, seed = 0) {
  return (
    Math.sin(t * 0.9 + seed) * 0.5 +
    Math.sin(t * 2.3 + seed * 1.7) * 0.3 +
    Math.sin(t * 5.1 + seed * 3.1) * 0.2
  );
}

// Damped spring: chases `target`, smooths spikes so fast drags settle
// smoothly instead of snapping.
function spring(value, velocity, target, stiffness, damping, dt) {
  const force = (target - value) * stiffness - velocity * damping;
  const newVel = velocity + force * dt;
  const newVal = value + newVel * dt;
  return [newVal, newVel];
}

const GESTURES = [
  'weightShift', 'headTilt', 'shoulderRoll', 'stretch',
  'lookAround', 'breathHitch', 'toeTap', 'kneeBounce', 'bodySway'
];

export function makeFloat() {
  // ---- Turn chain: head leads, body follows, limbs trail, cape whips last ----
  let lastYaw = 0;
  let turnVel = 0, turnVelVel = 0;   // smoothed raw yaw velocity
  let headTurn = 0, headTurnVel = 0; // reacts FIRST — "looks" into the turn
  let bodyLean = 0, bodyLeanVel = 0; // follows head a beat later
  let armLean = 0, armLeanVel = 0;   // follows body
  let legLean = 0, legLeanVel = 0;
  let capeLean = 0, capeLeanVel = 0; // laziest, biggest lag + overshoot

  // Secondary motion springs
  let capeBob = 0, capeBobVel = 0;   // cape swings off the vertical bob
  let legBob = 0, legBobVel = 0;     // knees give on float rise/fall

  // Toe-tap oscillator
  let toeTapPhase = 0;

  // Micro-gesture state
  let gesture = null;
  let nextGestureAt = 1.5 + Math.random() * 2.5;

  // Micro-saccade state (quick small head flicks, independent of gestures)
  let saccadeYaw = 0, saccadeYawVel = 0;
  let saccadeTarget = 0;
  let nextSaccadeAt = 0.5 + Math.random() * 1.5;

  // Breath cycle (inhale → hold → exhale → rest, irregular period)
  let breathPhase = 0;
  let breathRate = 0.6 + Math.random() * 0.4;

  const soulOffset = Math.random() * Math.PI * 2;

  function applyGesture(player, type, env, clock) {
    switch (type) {
      case 'weightShift': {
        const s = Math.sin(clock * 1.8 + soulOffset) > 0 ? 1 : -1;
        player.skin.body.position.z += s * env * 0.09;
        player.skin.leftLeg.rotation.z += s * env * 0.06;
        player.skin.rightLeg.rotation.z -= s * env * 0.06;
        player.skin.body.rotation.x += s * env * 0.02;
        break;
      }
      case 'headTilt':
        player.skin.head.rotation.z += env * 0.14;
        player.skin.head.rotation.y += env * 0.09;
        player.skin.head.rotation.x -= env * 0.03;
        break;
      case 'shoulderRoll':
        player.skin.leftArm.rotation.z -= env * 0.1;
        player.skin.rightArm.rotation.z += env * 0.05;
        player.skin.leftArm.rotation.x -= env * 0.07;
        player.skin.rightArm.rotation.x += env * 0.03;
        break;
      case 'stretch':
        player.skin.body.rotation.x -= env * 0.06;
        player.skin.leftArm.rotation.z -= env * 0.18;
        player.skin.rightArm.rotation.z += env * 0.12;
        player.skin.head.rotation.x -= env * 0.05;
        player.skin.body.position.y += env * 0.02;
        break;
      case 'lookAround':
        player.skin.head.rotation.y += env * 0.15;
        player.skin.head.rotation.x += env * 0.04;
        player.skin.body.rotation.y += env * 0.03;
        break;
      case 'breathHitch':
        player.skin.body.rotation.x += env * 0.04;
        player.skin.body.position.y -= env * 0.03;
        player.skin.head.rotation.x += env * 0.03;
        break;
      case 'toeTap': {
        toeTapPhase += 0.45;
        const tap = Math.max(0, Math.sin(toeTapPhase)) * env;
        player.skin.rightLeg.rotation.x -= tap * 0.22;
        player.skin.rightLeg.rotation.z -= tap * 0.03;
        player.skin.body.position.x += tap * 0.01;
        break;
      }
      case 'kneeBounce':
        player.skin.leftLeg.rotation.x += Math.sin(clock * 6) * env * 0.1;
        player.skin.rightLeg.rotation.x += Math.sin(clock * 6) * env * 0.1;
        player.skin.body.position.y -= Math.abs(Math.sin(clock * 6)) * env * 0.04;
        break;
      case 'bodySway':
        player.skin.body.position.z += Math.sin(clock * 3) * env * 0.04;
        player.skin.body.rotation.z += Math.sin(clock * 2.5) * env * 0.03;
        player.skin.leftArm.rotation.y += Math.sin(clock * 2) * env * 0.02;
        player.skin.rightArm.rotation.y -= Math.sin(clock * 2) * env * 0.02;
        break;
    }
  }

  return new FunctionAnimation((player, time, delta) => {
    const dt = Math.min(delta || 0.016, 0.05);
    const clock = time || 0;

    // ---- Turn signal: smoothed yaw velocity ----
    const wrapper = player.playerWrapper;
    const currentYaw = wrapper ? wrapper.rotation.y : 0;
    const rawYawVel = dt > 0 ? (currentYaw - lastYaw) / dt : 0;
    lastYaw = currentYaw;
    [turnVel, turnVelVel] = spring(turnVel, turnVelVel, rawYawVel, 90, 16, dt);
    const turn = Math.max(-1, Math.min(1, turnVel * 2.0));

    // ---- Whip-chain: each link chases the previous, softer each time ----
    [headTurn, headTurnVel] = spring(headTurn, headTurnVel, turn, 130, 18, dt);   // fastest — head looks first
    [bodyLean, bodyLeanVel] = spring(bodyLean, bodyLeanVel, headTurn, 60, 12, dt);  // body follows head
    [armLean, armLeanVel] = spring(armLean, armLeanVel, bodyLean, 40, 10, dt);      // arms follow body
    [legLean, legLeanVel] = spring(legLean, legLeanVel, bodyLean, 50, 10, dt);      // legs follow body
    [capeLean, capeLeanVel] = spring(capeLean, capeLeanVel, bodyLean, 18, 6, dt);   // cape is last & biggest

    // ---- Breath: inhale → hold → exhale → rest, irregular period ----
    breathPhase += dt * breathRate;
    if (breathPhase > Math.PI * 2 + Math.random() * 1.2) {
      breathPhase = 0;
      breathRate = 0.5 + Math.random() * 0.5;
    }
    const breath = Math.sin(breathPhase);
    const inhale = Math.max(0, breath);
    const exhale = Math.max(0, -breath);

    // ---- Base float: gentle hover + organic drift ----
    const bob = Math.sin(clock * 0.9 + soulOffset) * 0.11
      + Math.sin(clock * 0.37 + soulOffset * 0.7) * 0.04;
    const driftX = noise(clock * 0.28 + soulOffset, 11) * 0.018;
    const driftZ = noise(clock * 0.22 + soulOffset, 42) * 0.025;
    [capeBob, capeBobVel] = spring(capeBob, capeBobVel, bob, 14, 5, dt);

    player.position.y = bob;
    player.position.x = driftX;
    player.position.z = driftZ;

    // ========================================================================
    // BODY — every bone moves here
    // ========================================================================
    player.skin.body.rotation.x = -0.12 + inhale * 0.05
      + noise(clock * 0.5 + soulOffset, 3) * 0.015;
    player.skin.body.rotation.y = noise(clock * 0.38 + soulOffset, 7) * 0.045
      + bodyLean * 0.28;
    player.skin.body.rotation.z = noise(clock * 0.3 + soulOffset, 19) * 0.02
      - bodyLean * 0.34;
    player.skin.body.position.y = -6 + inhale * 0.05;
    player.skin.body.position.z = driftZ * 0.5;

    // ========================================================================
    // HEAD — leads turns, plus micro-saccades
    // ========================================================================
    if (clock >= nextSaccadeAt) {
      saccadeTarget = (Math.random() - 0.5) * 0.35;
      nextSaccadeAt = clock + 0.55 + Math.random() * 2.0;
    }
    [saccadeYaw, saccadeYawVel] = spring(saccadeYaw, saccadeYawVel, saccadeTarget, 150, 16, dt);

    player.skin.head.rotation.x = -0.07 + exhale * 0.025
      + noise(clock * 0.55 + soulOffset, 5) * 0.025;
    player.skin.head.rotation.y = noise(clock * 0.42 + soulOffset, 9) * 0.05
      + headTurn * 0.38 + saccadeYaw;
    player.skin.head.rotation.z = noise(clock * 0.28 + soulOffset, 2) * 0.012;

    // Ears move with head but slightly delayed/softer
    const earYaw = player.skin.head.rotation.y * 0.5;
    const earPitch = player.skin.head.rotation.x * 0.4;

    // ========================================================================
    // ARMS — trail body, never mirrored, react to turns & breath
    // ========================================================================
    const armNoiseL = noise(clock * 0.48 + soulOffset, 13);
    const armNoiseR = noise(clock * 0.48 + soulOffset, 14);
    const armSway = Math.sin(clock * 0.5 + soulOffset) * 0.02;

    player.skin.leftArm.rotation.x = -0.16 + armNoiseL * 0.03 + armLean * 0.32
      + exhale * 0.03 + armSway;
    player.skin.rightArm.rotation.x = -0.16 - armNoiseR * 0.03 - armLean * 0.32
      + exhale * 0.03 - armSway;
    player.skin.leftArm.rotation.z = Math.PI * 0.055 + noise(clock * 0.58 + soulOffset, 21) * 0.018;
    player.skin.rightArm.rotation.z = -Math.PI * 0.055 - noise(clock * 0.58 + soulOffset, 23) * 0.018;
    player.skin.leftArm.rotation.y = 0.05 + noise(clock * 0.36 + soulOffset, 17) * 0.012
      + armLean * 0.15;
    player.skin.rightArm.rotation.y = -0.05 - noise(clock * 0.36 + soulOffset, 25) * 0.012
      - armLean * 0.15;

    // Arms also sway with breath — inhale lifts shoulders slightly
    player.skin.leftArm.rotation.z += inhale * 0.02;
    player.skin.rightArm.rotation.z -= inhale * 0.02;

    // ========================================================================
    // LEGS — weight-bearing, reactive, weight transfer between feet
    // ========================================================================
    [legBob, legBobVel] = spring(legBob, legBobVel, bob, 30, 7, dt);
    const kneeGive = (bob - legBob) * 1.6; // knees absorb the float's rise/fall

    // Slow weight transfer + irregular fast wobble on top
    const weightSway = Math.sin(clock * 0.22 + soulOffset * 1.3);
    const weightShiftFast = noise(clock * 0.18 + soulOffset, 40);

    player.skin.leftLeg.rotation.x = 0.05 + noise(clock * 0.5 + soulOffset, 29) * 0.015
      - legLean * 0.2 + kneeGive * 0.45 + Math.max(0, weightSway) * 0.055;
    player.skin.rightLeg.rotation.x = 0.05 - noise(clock * 0.5 + soulOffset, 31) * 0.015
      + legLean * 0.2 + kneeGive * 0.45 + Math.max(0, -weightSway) * 0.055;

    player.skin.leftLeg.rotation.z = 0.01 + noise(clock * 0.33 + soulOffset, 33) * 0.008
      + weightSway * 0.03;
    player.skin.rightLeg.rotation.z = -0.01 - noise(clock * 0.33 + soulOffset, 35) * 0.008
      + weightSway * 0.03;

    // Feet splay independently — legs had zero rotation.y before, now they read as placed
    player.skin.leftLeg.rotation.y = 0.02 + noise(clock * 0.3 + soulOffset, 37) * 0.02
      + weightShiftFast * 0.018;
    player.skin.rightLeg.rotation.y = -0.02 - noise(clock * 0.3 + soulOffset, 39) * 0.02
      - weightShiftFast * 0.018;

    // Hips nudge with weight transfer so it reads through the whole lower body
    player.skin.body.position.x = weightSway * 0.03;

    // ========================================================================
    // CAPE — billows, lags the whole chain + the bob, biggest of all
    // ========================================================================
    player.cape.rotation.x = Math.PI * 0.09 + Math.sin(clock * 0.75 + soulOffset) * 0.04
      + noise(clock * 1.1 + soulOffset, 4) * 0.03 + (bob - capeBob) * 0.7;
    player.cape.rotation.z = noise(clock * 0.48 + soulOffset, 6) * 0.04 + capeLean * 0.6;
    player.cape.rotation.y = noise(clock * 0.35 + soulOffset, 10) * 0.02 - capeLean * 0.28;

    // ========================================================================
    // Random micro-idle gestures layered on top
    // ========================================================================
    if (!gesture && clock >= nextGestureAt) {
      gesture = {
        type: GESTURES[Math.floor(Math.random() * GESTURES.length)],
        start: clock,
        duration: 1.4 + Math.random() * 1.6,
      };
    }
    if (gesture) {
      const t = (clock - gesture.start) / gesture.duration;
      if (t >= 1) {
        gesture = null;
        nextGestureAt = clock + 2.5 + Math.random() * 4;
      } else {
        const env = Math.sin(Math.PI * Math.min(1, Math.max(0, t)));
        applyGesture(player, gesture.type, env, clock);
      }
    }
  });
}
