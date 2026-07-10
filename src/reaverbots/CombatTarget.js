import * as THREE from 'three';

const DEFAULT_AIM_HEIGHT = 1.15;

export function getCombatTargetOwner(target) {
  return target?.ownerEnemy ?? target?.enemy ?? target ?? null;
}

export function getCombatTargetWorldPosition(target, out = new THREE.Vector3()) {
  if (!target) {
    return out.set(0, 0, 0);
  }

  if (typeof target.getWorldPosition === 'function' && !target.isObject3D) {
    return target.getWorldPosition(out);
  }

  const root = target.root ?? target;
  if (root?.isObject3D) {
    root.getWorldPosition(out);
  } else if (root?.position) {
    out.copy(root.position);
  } else {
    out.set(0, 0, 0);
  }

  if (!target.isWeakPointTarget) {
    out.y += target.combatAimOffset ?? target.aimHeight ?? DEFAULT_AIM_HEIGHT;
  }

  return out;
}

export function isCombatTargetValid(target) {
  const owner = getCombatTargetOwner(target);
  return Boolean(
    target?.root
    && target.active !== false
    && !target.dead
    && !owner?.dead
    && owner?.root?.parent,
  );
}

export function getEnemyCombatTargets(enemy) {
  const targets = enemy?.getCombatTargets?.();
  if (!Array.isArray(targets) || targets.length === 0) {
    return enemy ? [enemy] : [];
  }
  return targets;
}

export function getCombatTargetId(target) {
  return target?.id ?? getCombatTargetOwner(target)?.id ?? null;
}
