import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();
const tempVectorD = new THREE.Vector3();
const tempVectorE = new THREE.Vector3();
const AIM_RECENTER_RESPONSIVENESS = 18;
const TANK_TURN_YAW_RESPONSIVENESS = 3.8;
const TANK_TURN_FOLLOW_RESPONSIVENESS = 6.2;
const VERTICAL_FOCUS_RESPONSIVENESS = 8.5;
const ELEVATION_TRANSITION_RESPONSIVENESS = 5.2;

function lerpAngle(current, target, alpha) {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  return current + delta * alpha;
}

export class CameraController {
  constructor(camera, {
    distance = 6.8,
    height = 3.25,
    lookHeight = 1.35,
    lookAhead = 1.7,
    followResponsiveness = 7,
    yawResponsiveness = 5.4,
  } = {}) {
    this.camera = camera;
    this.distance = distance;
    this.height = height;
    this.lookHeight = lookHeight;
    this.lookAhead = lookAhead;
    this.baseDistance = distance;
    this.baseHeight = height;
    this.baseLookAhead = lookAhead;
    this.followResponsiveness = followResponsiveness;
    this.yawResponsiveness = yawResponsiveness;
    this.yaw = 0;
    this.recenterTimer = 0;
    this.forceBodyFacingRecenter = false;
    this.movementForward = new THREE.Vector3(0, 0, 1);
    this.movementRight = new THREE.Vector3(1, 0, 0);
    this.smoothedTargetY = 0;
    this.hasSmoothedTarget = false;
  }

  getMovementBasis(fallbackForward = null) {
    this.syncMovementBasis(fallbackForward);
    return {
      forward: this.movementForward,
      right: this.movementRight,
    };
  }

  syncMovementBasis(fallbackForward = null) {
    this.camera.getWorldDirection(this.movementForward);
    this.movementForward.y = 0;

    if (this.movementForward.lengthSq() <= 0.0001) {
      if (fallbackForward && fallbackForward.lengthSq() > 0.0001) {
        this.movementForward.copy(fallbackForward);
        this.movementForward.y = 0;
      } else {
        this.movementForward.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      }
    }

    this.movementForward.normalize();
    this.movementRight.crossVectors(this.movementForward, WORLD_UP).normalize();
  }

  update(dt, player) {
    const root = player?.root;
    if (!root) {
      return;
    }

    const tankTurnActive = Boolean(player.tankTurnActive);
    const forcedRecentering = this.recenterTimer > 0;
    const forceBodyFacingRecenter = forcedRecentering && this.forceBodyFacingRecenter;
    const facingDirection = forceBodyFacingRecenter || tankTurnActive
      ? this._getPlayerBodyFacingDirection(player)
      : this._getPlayerFacingDirection(player);

    const targetYaw = Math.atan2(facingDirection.x, facingDirection.z);
    const responsiveness = tankTurnActive
      ? TANK_TURN_YAW_RESPONSIVENESS
      : forceBodyFacingRecenter
        ? AIM_RECENTER_RESPONSIVENESS
        : forcedRecentering
          ? 16
          : this.yawResponsiveness;
    const yawAlpha = Math.min(1, dt * responsiveness);
    this.yaw = lerpAngle(this.yaw, targetYaw, yawAlpha);

    this.recenterTimer = Math.max(0, this.recenterTimer - dt);
    if (this.recenterTimer <= 0) {
      this.forceBodyFacingRecenter = false;
    }

    const running = Boolean(player.isRunning);
    const cameraEase = Math.min(1, dt * 3.5);
    this.distance = THREE.MathUtils.lerp(this.distance, this.baseDistance + (running ? 0.72 : 0), cameraEase);
    this.height = THREE.MathUtils.lerp(this.height, this.baseHeight + (running ? 0.12 : 0), cameraEase);
    this.lookAhead = THREE.MathUtils.lerp(this.lookAhead, this.baseLookAhead + (running ? 0.48 : 0), cameraEase);

    const forward = tempVectorD.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const rawTarget = typeof player.getCameraFocusPosition === 'function'
      ? player.getCameraFocusPosition(tempVectorE)
      : tempVectorE.copy(root.position);
    const target = tempVectorE.copy(rawTarget);
    if (!this.hasSmoothedTarget || dt >= 1) {
      this.smoothedTargetY = rawTarget.y;
      this.hasSmoothedTarget = true;
    } else {
      const actionActive = Boolean(player.animation?.isFullBodyActionActive?.() || player.isLedgeClinging?.());
      const verticalResponsiveness = actionActive
        ? VERTICAL_FOCUS_RESPONSIVENESS
        : ELEVATION_TRANSITION_RESPONSIVENESS;
      this.smoothedTargetY = THREE.MathUtils.lerp(
        this.smoothedTargetY,
        rawTarget.y,
        Math.min(1, dt * verticalResponsiveness),
      );
    }
    target.y = this.smoothedTargetY;

    const desiredPosition = tempVectorB.copy(target)
      .addScaledVector(forward, -this.distance);
    desiredPosition.y += this.height;

    const lookTarget = tempVectorA.copy(target)
      .addScaledVector(forward, this.lookAhead);
    lookTarget.y += this.lookHeight;

    const followResponsiveness = tankTurnActive
      ? TANK_TURN_FOLLOW_RESPONSIVENESS
      : this.followResponsiveness;
    const followAlpha = Math.min(1, dt * followResponsiveness);
    this.camera.position.lerp(desiredPosition, followAlpha);
    this.camera.lookAt(lookTarget);
    this.syncMovementBasis(facingDirection);
  }

  snapTo(player) {
    this.hasSmoothedTarget = false;
    this.update(1, player);
  }

  swingBehindPlayer(player = null) {
    this.recenterTimer = Math.max(this.recenterTimer, 0.42);
    this.forceBodyFacingRecenter = Boolean(player?.root);
  }

  _getPlayerFacingDirection(player) {
    const direction = tempVectorC;

    if (player.attackFacingTimer > 0 && player.attackFacingDirection?.lengthSq() > 0.0001) {
      direction.copy(player.attackFacingDirection);
    } else if (player.bracedFireTimer > 0 && player.bracedFireDirection?.lengthSq() > 0.0001) {
      direction.copy(player.bracedFireDirection);
    } else if (player.lastMoveDirection?.lengthSq() > 0.0001) {
      direction.copy(player.lastMoveDirection);
    } else {
      direction.set(Math.sin(player.root.rotation.y), 0, Math.cos(player.root.rotation.y));
    }

    direction.y = 0;
    if (direction.lengthSq() <= 0.0001) {
      direction.set(0, 0, 1);
    }

    return direction.normalize();
  }

  _getPlayerBodyFacingDirection(player) {
    const direction = tempVectorC;
    direction.set(Math.sin(player.root.rotation.y), 0, Math.cos(player.root.rotation.y));

    if (direction.lengthSq() <= 0.0001) {
      direction.set(0, 0, 1);
    }

    return direction.normalize();
  }
}

export default CameraController;
