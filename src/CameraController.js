import * as THREE from 'three';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
const tempVectorA = new THREE.Vector3();
const tempVectorB = new THREE.Vector3();
const tempVectorC = new THREE.Vector3();
const tempVectorD = new THREE.Vector3();

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
    this.movementForward = new THREE.Vector3(0, 0, 1);
    this.movementRight = new THREE.Vector3(1, 0, 0);
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

    const facingDirection = this._getPlayerFacingDirection(player);
    const targetYaw = Math.atan2(facingDirection.x, facingDirection.z);
    const yawAlpha = Math.min(1, dt * this.yawResponsiveness);
    this.yaw = lerpAngle(this.yaw, targetYaw, yawAlpha);

    const running = Boolean(player.isRunning);
    const cameraEase = Math.min(1, dt * 3.5);
    this.distance = THREE.MathUtils.lerp(this.distance, this.baseDistance + (running ? 0.72 : 0), cameraEase);
    this.height = THREE.MathUtils.lerp(this.height, this.baseHeight + (running ? 0.12 : 0), cameraEase);
    this.lookAhead = THREE.MathUtils.lerp(this.lookAhead, this.baseLookAhead + (running ? 0.48 : 0), cameraEase);

    const forward = tempVectorD.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    const target = root.position;
    const desiredPosition = tempVectorB.copy(target)
      .addScaledVector(forward, -this.distance);
    desiredPosition.y += this.height;

    const lookTarget = tempVectorA.copy(target)
      .addScaledVector(forward, this.lookAhead);
    lookTarget.y += this.lookHeight;

    const followAlpha = Math.min(1, dt * this.followResponsiveness);
    this.camera.position.lerp(desiredPosition, followAlpha);
    this.camera.lookAt(lookTarget);
    this.syncMovementBasis(facingDirection);
  }

  snapTo(player) {
    this.update(1, player);
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
}

export default CameraController;
