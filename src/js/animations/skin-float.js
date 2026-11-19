// ===== Skin animation: dynamic float =====
// One procedural animation that drives a relaxed pose, continuous sway,
// and turn reaction (turntable / orbit / drag). No separate idle/walk/run
// states — time + yaw velocity are enough to keep the model feeling alive.
import { FunctionAnimation } from 'skinview3d';

export function makeFloat() {
  let lastYaw = 0;
  let hoverTime = 0;

  return new FunctionAnimation((player, progress) => {
    hoverTime += 0.016;

    const wrapper = player.playerWrapper;
    const currentYaw = wrapper ? wrapper.rotation.y : 0;
    const yawDiff = currentYaw - lastYaw;
    lastYaw = currentYaw;

    // Turn strength (-1 to 1): how fast the model is being turned right now.
    const turn = Math.max(-1, Math.min(1, yawDiff * 8));

    // ---- Base pose: relaxed stance ----
    player.skin.body.rotation.y = 0.06;
    player.skin.body.rotation.x = 0.01;
    player.skin.body.position.y = -6;
    player.skin.body.position.z = 0;

    player.skin.head.rotation.y = 0;
    player.skin.head.rotation.x = -0.04;

    player.skin.leftArm.rotation.z = Math.PI * 0.04;
    player.skin.rightArm.rotation.z = -Math.PI * 0.04;
    player.skin.leftArm.rotation.x = 0.01;
    player.skin.rightArm.rotation.x = -0.01;
    player.skin.leftArm.rotation.y = 0.02;
    player.skin.rightArm.rotation.y = -0.02;

    player.skin.leftLeg.rotation.x = 0;
    player.skin.rightLeg.rotation.x = 0;
    player.skin.leftLeg.rotation.z = 0.01;
    player.skin.rightLeg.rotation.z = -0.01;

    player.cape.rotation.x = Math.PI * 0.05;
    player.cape.rotation.z = 0;

    // ---- Sway: continuous independent motion ----
    const sway = Math.sin(hoverTime * 0.7) * 0.025;
    const breathe = Math.sin(hoverTime * 1.3) * 0.018;
    const bob = Math.sin(hoverTime * 1.0) * 0.1;

    player.position.y = bob;
    player.skin.body.rotation.y = 0.06 + sway;
    player.skin.body.rotation.x = 0.01 + breathe;
    player.skin.body.position.y = -6 + breathe * 0.06;

    // Weight shift: hips sway opposite to torso.
    player.skin.body.position.z = sway * 0.6;
    player.skin.leftLeg.rotation.z = 0.01 + sway * 0.4;
    player.skin.rightLeg.rotation.z = -0.01 - sway * 0.4;

    // Arms sway opposite to the body's sway.
    player.skin.leftArm.rotation.z = Math.PI * 0.04 - sway * 0.5;
    player.skin.rightArm.rotation.z = -Math.PI * 0.04 + sway * 0.5;

    // Head follows sway softly, slight nod with breath.
    player.skin.head.rotation.y = sway * 0.25;
    player.skin.head.rotation.x = -0.04 + breathe * 0.6;

    // Cape breathes gently.
    player.cape.rotation.x = Math.PI * 0.05 + Math.sin(hoverTime * 1.1) * 0.02;

    // ---- Turn reaction: lean into the turn ----
    player.skin.body.rotation.z = -turn * 0.14;
    player.skin.body.rotation.y += turn * 0.12;

    player.skin.leftArm.rotation.z += turn * 0.09;
    player.skin.rightArm.rotation.z -= turn * 0.09;

    player.skin.head.rotation.y += turn * 0.16;
    player.skin.head.rotation.x += turn * 0.03;

    player.cape.rotation.z = turn * 0.06;
    player.cape.rotation.x += turn * 0.04;
  });
}
