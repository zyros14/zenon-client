// ===== Skin animation: superhero float =====
// Organic, alive-feeling idle: forward-lean float with breathing, weight shifts,
// reactive turn response, and random micro-gestures. Nothing repeats on a short
// cycle; everything is layered noise + spring-damped reaction.
//
// Limbs trail the body by one frame (~0.1ms at 60fps) so they feel heavy and
// physical, not robotically locked to the torso.
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

// Critically damped spring: chases `target`, smooths spikes so fast drags
// settle smoothly instead of snapping.
function spring(value, velocity, target, stiffness, damping, dt) {
  const force = (target - value) * stiffness - velocity * damping;
  const newVel = velocity + force * dt;
  const newVal = value + newVel * dt;
  return [newVal, newVel];
}

const GESTURES = ['weightShift', 'headTilt', 'shoulderRoll', 'stretch', 'lookAround', 'breathHitch'];

export function makeFloat() {
  // Turn tracking (spring-damped)
  let lastYaw = 0;
  let turnVel = 0, turnVelVel = 0;
  let leanVal = 0, leanVel = 0;
  let swapVal = 0, swapVel = 0;

  // One-frame limb lag: limbs apply the PREVIOUS frame's lean/swap so they
  // trail the body by ~0.1ms (one frame at 60fps).
  let prevLeanVal = 0;
  let prevSwapVal = 0;

  // Micro-gesture state
  let gesture = null;
  let nextGestureAt = 1.5 + Math.random() * 2.5;

  // Breath cycle (inhale → hold → exhale → rest, ~5-7s, not perfectly periodic)
  let breathPhase = 0;
  let breathRate = 0.6 + Math.random() * 0.4;

  // Subtle "aliveness" offset so two skins never move identically
  const soulOffset = Math.random() * Math.PI * 2;

  return new FunctionAnimation((player, time, delta) => {
    const dt = Math.min(delta || 0.016, 0.05);
    const clock = time || 0;

    const wrapper = player.playerWrapper;
    const currentYaw = wrapper ? wrapper.rotation.y : 0;
    const rawYawVel = dt > 0 ? (currentYaw - lastYaw) / dt : 0;
    lastYaw = currentYaw;

    // Smooth yaw velocity before anything reacts — higher stiffness = snappier
    // reaction to being spun on the turntable.
    [turnVel, turnVelVel] = spring(turnVel, turnVelVel, rawYawVel, 80, 14, dt);
    const turn = Math.max(-1, Math.min(1, turnVel * 1.6));

    // Springs chase the smoothed turn — body reacts first, limbs trail.
    [leanVal, leanVel] = spring(leanVal, leanVel, turn, 80, 14, dt);
    [swapVal, swapVel] = spring(swapVal, swapVel, turn, 30, 10, dt);

    // ---- Breath: inhale (chest up) → hold → exhale → rest ------------------
    breathPhase += dt * breathRate;
    if (breathPhase > Math.PI * 2 + Math.random() * 1) {
      breathPhase = 0;
      breathRate = 0.5 + Math.random() * 0.5;
    }
    const breath = Math.sin(breathPhase); // -1 → 1, smooth
    const inhale = Math.max(0, breath);   // chest rises
    const exhale = Math.max(0, -breath);  // chest falls

    // ---- Base float: gentle hover + organic drift --------------------------
    const bob = Math.sin(clock * 0.9 + soulOffset) * 0.11 + Math.sin(clock * 0.37 + soulOffset * 0.7) * 0.04;
    const driftX = noise(clock * 0.28 + soulOffset, 11) * 0.018;
    const driftZ = noise(clock * 0.22 + soulOffset, 42) * 0.025;

    player.position.y = bob;
    player.position.x = driftX;
    player.position.z = driftZ;

    // ---- Body: forward lean + breathing chest ------------------------------
    player.skin.body.rotation.x = -0.12 + inhale * 0.04 + noise(clock * 0.5 + soulOffset, 3) * 0.015;
    player.skin.body.rotation.y = noise(clock * 0.38 + soulOffset, 7) * 0.045;
    player.skin.body.rotation.z = noise(clock * 0.3 + soulOffset, 19) * 0.02;
    player.skin.body.position.y = -6 + inhale * 0.05;
    player.skin.body.position.z = driftZ * 0.5;

    // ---- Head: independent look-around, follows body softly ----------------
    player.skin.head.rotation.x = -0.07 + exhale * 0.02 + noise(clock * 0.55 + soulOffset, 5) * 0.025;
    player.skin.head.rotation.y = noise(clock * 0.42 + soulOffset, 9) * 0.05;
    player.skin.head.rotation.z = noise(clock * 0.28 + soulOffset, 2) * 0.012;

    // ---- Arms: trail back/out, never mirrored ------------------------------
    const armNoiseL = noise(clock * 0.48 + soulOffset, 13);
    const armNoiseR = noise(clock * 0.48 + soulOffset, 14);
    player.skin.leftArm.rotation.x = -0.16 + armNoiseL * 0.03;
    player.skin.rightArm.rotation.x = -0.16 - armNoiseR * 0.03;
    player.skin.leftArm.rotation.z = Math.PI * 0.055 + noise(clock * 0.58 + soulOffset, 21) * 0.018;
    player.skin.rightArm.rotation.z = -Math.PI * 0.055 - noise(clock * 0.58 + soulOffset, 23) * 0.018;
    player.skin.leftArm.rotation.y = 0.05 + noise(clock * 0.36 + soulOffset, 17) * 0.012;
    player.skin.rightArm.rotation.y = -0.05 - noise(clock * 0.36 + soulOffset, 25) * 0.012;

    // ---- Legs: loose, relaxed ---------------------------------------------
    player.skin.leftLeg.rotation.x = 0.05 + noise(clock * 0.5 + soulOffset, 29) * 0.015;
    player.skin.rightLeg.rotation.x = 0.05 - noise(clock * 0.5 + soulOffset, 31) * 0.015;
    player.skin.leftLeg.rotation.z = 0.01 + noise(clock * 0.33 + soulOffset, 33) * 0.008;
    player.skin.rightLeg.rotation.z = -0.01 - noise(clock * 0.33 + soulOffset, 35) * 0.008;

    // ---- Cape: billowing, catches wind -------------------------------------
    player.cape.rotation.x = Math.PI * 0.09 + Math.sin(clock * 0.75 + soulOffset) * 0.035 + noise(clock * 1.1 + soulOffset, 4) * 0.025;
    player.cape.rotation.z = noise(clock * 0.48 + soulOffset, 6) * 0.035;
    player.cape.rotation.y = noise(clock * 0.35 + soulOffset, 10) * 0.015;

    // ---- Random micro-idle gestures ---------------------------------------
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
        const env = Math.sin(Math.PI * Math.min(1, Math.max(0, t))); // smooth in → out
        applyGesture(player, gesture.type, env, clock);
      }
    }

    // ---- Turn reaction: lean into turns, catch balance ---------------------
    // Body reacts immediately to the current turn value.
    player.skin.body.rotation.z += -leanVal * 0.28;
    player.skin.body.rotation.y += leanVal * 0.24;

    // Limbs apply the PREVIOUS frame's values — one frame of lag (~0.1ms),
    // so arms and legs trail the body instead of moving in lockstep.
    player.skin.leftArm.rotation.x += prevSwapVal * 0.22;
    player.skin.rightArm.rotation.x -= prevSwapVal * 0.22;
    player.skin.leftLeg.rotation.x -= prevSwapVal * 0.14;
    player.skin.rightLeg.rotation.x += prevSwapVal * 0.14;

    player.skin.head.rotation.y += prevLeanVal * 0.3;
    player.skin.head.rotation.x += Math.abs(prevLeanVal) * 0.03;

    player.cape.rotation.z += prevLeanVal * 0.14;
    player.cape.rotation.x += Math.abs(prevLeanVal) * 0.08;

    // Store this frame's values for next frame's limb lag.
    prevLeanVal = leanVal;
    prevSwapVal = swapVal;
  });
}

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
      // Sudden sharp exhale then slow inhale — breaks the breathing loop
      player.skin.body.rotation.x += env * 0.04;
      player.skin.body.position.y -= env * 0.03;
      player.skin.head.rotation.x += env * 0.03;
      break;
  }
}
