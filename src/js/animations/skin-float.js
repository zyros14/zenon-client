// ===== Skin animation: superhero float =====
// Continuous "flying" idle: forward lean, trailing limbs, billowing cape.
// Layered sine noise instead of single sines so nothing repeats in an
// obviously loopy way. Turn reaction is spring-damped (not a raw per-frame
// delta) so fast drags settle smoothly instead of snapping/jittering.
// Random micro-gestures (weight shift, head tilt, shoulder roll, stretch)
// fire on a random timer and fade in/out, so the idle never looks static
// or robotically looped even over a long time.
import { FunctionAnimation } from 'skinview3d';

// Smooth pseudo-noise: sum of a few incommensurate sine frequencies.
// Looks organic, never repeats on a short, noticeable cycle.
function noise(t, seed = 0) {
  return (
    Math.sin(t * 0.9 + seed) * 0.5 +
    Math.sin(t * 2.3 + seed * 1.7) * 0.3 +
    Math.sin(t * 5.1 + seed * 3.1) * 0.2
  );
}

// Critically-ish damped spring: chases `target`, smooths out spikes
// (e.g. a fast mouse-drag yaw change) instead of reacting 1:1 to them.
function spring(value, velocity, target, stiffness, damping, dt) {
  const force = (target - value) * stiffness - velocity * damping;
  const newVel = velocity + force * dt;
  const newVal = value + newVel * dt;
  return [newVal, newVel];
}

const GESTURES = ['weightShift', 'headTilt', 'shoulderRoll', 'stretch'];

export function makeFloat() {
  // Turn tracking
  let lastYaw = 0;
  let turnVel = 0, turnVelVel = 0;   // smoothed yaw velocity
  let leanVal = 0, leanVel = 0;      // body lean spring (reacts to turnVel)
  let swapVal = 0, swapVel = 0;      // limb-swap spring (reacts to turnVel)

  // Random micro-idle gesture state
  let gesture = null;
  let nextGestureAt = 2 + Math.random() * 3;

  // FunctionAnimation calls back with (player, time, delta), both in seconds.
  return new FunctionAnimation((player, time, delta) => {
    const dt = Math.min(delta || 0.016, 0.05); // clamp so a lag spike can't fling the springs
    const clock = time || 0;

    const wrapper = player.playerWrapper;
    const currentYaw = wrapper ? wrapper.rotation.y : 0;
    const rawYawVel = dt > 0 ? (currentYaw - lastYaw) / dt : 0;
    lastYaw = currentYaw;

    // Smooth the raw yaw velocity itself before anything reacts to it.
    [turnVel, turnVelVel] = spring(turnVel, turnVelVel, rawYawVel, 40, 10, dt);
    const turn = Math.max(-1, Math.min(1, turnVel * 1.2));

    // Lean and limb-swap each chase the smoothed turn with their own spring,
    // so they overshoot slightly and settle — feels reactive, not snappy.
    [leanVal, leanVel] = spring(leanVal, leanVel, turn, 60, 12, dt);
    [swapVal, swapVel] = spring(swapVal, swapVel, turn, 25, 8, dt);

    // ---- Superhero float base pose ----
    const floatBob = Math.sin(clock * 0.9) * 0.12 + Math.sin(clock * 0.37) * 0.05;
    const driftX = noise(clock * 0.3, 11) * 0.015;
    const driftZ = noise(clock * 0.25, 42) * 0.02;

    player.position.y = floatBob;
    player.position.x = driftX;

    // Forward chest-up lean, like mid-flight.
    player.skin.body.rotation.x = -0.1 + noise(clock * 0.5, 3) * 0.02;
    player.skin.body.rotation.y = noise(clock * 0.4, 7) * 0.05;
    player.skin.body.rotation.z = noise(clock * 0.33, 19) * 0.025;
    player.skin.body.position.y = -6 + Math.sin(clock * 1.3) * 0.08;
    player.skin.body.position.z = driftZ;

    player.skin.head.rotation.x = -0.08 + noise(clock * 0.6, 5) * 0.03;
    player.skin.head.rotation.y = noise(clock * 0.45, 9) * 0.06;
    player.skin.head.rotation.z = noise(clock * 0.3, 2) * 0.015;

    // Arms trail back/out like mid-flight, each with its own drift so they
    // never move as a mirrored pair.
    player.skin.leftArm.rotation.x = -0.15 + noise(clock * 0.5, 13) * 0.03;
    player.skin.rightArm.rotation.x = -0.15 - noise(clock * 0.5, 14) * 0.03;
    player.skin.leftArm.rotation.z = Math.PI * 0.05 + noise(clock * 0.6, 21) * 0.02;
    player.skin.rightArm.rotation.z = -Math.PI * 0.05 - noise(clock * 0.6, 23) * 0.02;
    player.skin.leftArm.rotation.y = 0.04 + noise(clock * 0.4, 17) * 0.015;
    player.skin.rightArm.rotation.y = -0.04 - noise(clock * 0.4, 25) * 0.015;

    // Legs trail loosely, feet relaxed.
    player.skin.leftLeg.rotation.x = 0.06 + noise(clock * 0.5, 29) * 0.02;
    player.skin.rightLeg.rotation.x = 0.06 - noise(clock * 0.5, 31) * 0.02;
    player.skin.leftLeg.rotation.z = 0.015 + noise(clock * 0.35, 33) * 0.01;
    player.skin.rightLeg.rotation.z = -0.015 - noise(clock * 0.35, 35) * 0.01;

    // Cape billows like it's catching wind.
    player.cape.rotation.x = Math.PI * 0.08 + Math.sin(clock * 0.8) * 0.03 + noise(clock * 1.2, 4) * 0.02;
    player.cape.rotation.z = noise(clock * 0.5, 6) * 0.03;

    // ---- Random micro-idle gestures, layered on top ----
    if (!gesture && clock >= nextGestureAt) {
      gesture = {
        type: GESTURES[Math.floor(Math.random() * GESTURES.length)],
        start: clock,
        duration: 1.6 + Math.random() * 1.2,
      };
    }
    if (gesture) {
      const t = (clock - gesture.start) / gesture.duration;
      if (t >= 1) {
        gesture = null;
        nextGestureAt = clock + 3 + Math.random() * 4;
      } else {
        const env = Math.sin(Math.PI * Math.min(1, Math.max(0, t))); // smooth in → out
        applyGesture(player, gesture.type, env, clock);
      }
    }

    // ---- Turn reaction: lean + slight limb-swap, like catching your balance ----
    player.skin.body.rotation.z += -leanVal * 0.16;
    player.skin.body.rotation.y += leanVal * 0.14;

    // Just enough counter-swing in arms/legs to read as a weight shift —
    // not a full walk cycle, just a reactive flicker.
    player.skin.leftArm.rotation.x += swapVal * 0.12;
    player.skin.rightArm.rotation.x -= swapVal * 0.12;
    player.skin.leftLeg.rotation.x -= swapVal * 0.08;
    player.skin.rightLeg.rotation.x += swapVal * 0.08;

    player.skin.head.rotation.y += leanVal * 0.18;
    player.skin.head.rotation.x += Math.abs(leanVal) * 0.02;

    player.cape.rotation.z += leanVal * 0.08;
    player.cape.rotation.x += Math.abs(leanVal) * 0.05;
  });
}

function applyGesture(player, type, env, clock) {
  switch (type) {
    case 'weightShift': {
      const s = Math.sin(clock * 2.0) > 0 ? 1 : -1;
      player.skin.body.position.z += s * env * 0.08;
      player.skin.leftLeg.rotation.z += s * env * 0.05;
      player.skin.rightLeg.rotation.z -= s * env * 0.05;
      break;
    }
    case 'headTilt':
      player.skin.head.rotation.z += env * 0.12;
      player.skin.head.rotation.y += env * 0.08;
      break;
    case 'shoulderRoll':
      player.skin.leftArm.rotation.z -= env * 0.08;
      player.skin.rightArm.rotation.z += env * 0.04;
      player.skin.leftArm.rotation.x -= env * 0.06;
      break;
    case 'stretch':
      player.skin.body.rotation.x -= env * 0.05;
      player.skin.leftArm.rotation.z -= env * 0.15;
      player.skin.rightArm.rotation.z += env * 0.1;
      player.skin.head.rotation.x -= env * 0.04;
      break;
  }
}
