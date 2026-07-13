import * as THREE from 'three';

const DEFAULT_FADE_DURATION = 0.24;
const THINKING_DELAYS = Object.freeze([36, 52, 44]);

function normalizeActionName(name) {
  return String(name ?? '').trim().toLowerCase();
}

export class RollNpcAnimator {
  constructor(model, anchor) {
    this.model = model;
    this.anchor = anchor;
    this.mixer = new THREE.AnimationMixer(model);
    this.clips = new Map();
    this.actions = new Map();
    this.currentAction = null;
    this.currentName = null;
    this.pendingName = null;
    this.inactivitySeconds = 0;
    this.thinkingIndex = 0;
    this.nextThinkingSeconds = THINKING_DELAYS[0];
    this.assetsSettled = false;
    this.disposed = false;
    this._onFinished = ({ action }) => {
      if (this.disposed || action !== this.currentAction || this.currentName === 'idle') return;
      this.play('idle');
    };
    this.mixer.addEventListener('finished', this._onFinished);
    this._syncDebugState({ includeClips: true });
  }

  registerClip(name, clip) {
    const key = normalizeActionName(name);
    if (!key || !clip || clip.duration <= 0 || clip.tracks.length <= 0 || this.disposed) {
      return false;
    }

    clip.name = `roll_${key}`;
    this.clips.set(key, clip);
    this.actions.set(key, this.mixer.clipAction(clip));

    if (this.pendingName === key) {
      this.play(key);
    } else if (key === 'idle' && !this.currentAction && !this.pendingName) {
      this.play('idle', { fade: 0 });
    }

    this._syncDebugState({ includeClips: true });
    return true;
  }

  settleAssets() {
    this.assetsSettled = true;
    if (!this.currentAction) {
      const requested = this.pendingName && this.actions.has(this.pendingName)
        ? this.pendingName
        : 'idle';
      this.play(requested, { fade: 0 });
    }
    this._syncDebugState({ includeClips: true });
  }

  noteInteraction() {
    if (this.disposed) return false;
    this.inactivitySeconds = 0;
    this.thinkingIndex = 0;
    this.nextThinkingSeconds = THINKING_DELAYS[0];
    const played = this.play('explaining');
    if (!played) this.pendingName = 'explaining';
    this._syncDebugState();
    return played;
  }

  play(name, { fade = DEFAULT_FADE_DURATION, loop = null, restart = true } = {}) {
    const key = normalizeActionName(name);
    const action = this.actions.get(key);
    const clip = this.clips.get(key);
    if (!action || !clip || this.disposed) {
      this.pendingName = key || null;
      this._syncDebugState();
      return false;
    }

    const shouldLoop = loop ?? (key === 'idle');
    const previous = this.currentAction;
    if (previous === action && !restart) return true;

    action.enabled = true;
    action.clampWhenFinished = !shouldLoop;
    action.setEffectiveTimeScale(1);
    action.setEffectiveWeight(1);
    action.setLoop(shouldLoop ? THREE.LoopRepeat : THREE.LoopOnce, shouldLoop ? Infinity : 1);
    action.reset().play();

    if (previous && previous !== action) {
      if (fade > 0) action.crossFadeFrom(previous, fade, false);
      else previous.stop();
    }

    this.currentAction = action;
    this.currentName = key;
    this.pendingName = null;
    this._syncDebugState();
    return true;
  }

  update(dt, { allowAmbient = true } = {}) {
    if (this.disposed) return;
    const safeDt = Math.max(0, Number(dt) || 0);
    this.mixer.update(safeDt);

    if (!allowAmbient || this.currentName !== 'idle' || !this.actions.has('thinking')) {
      this._syncDebugState();
      return;
    }

    this.inactivitySeconds += safeDt;
    if (this.inactivitySeconds >= this.nextThinkingSeconds) {
      this.inactivitySeconds = 0;
      this.thinkingIndex = (this.thinkingIndex + 1) % THINKING_DELAYS.length;
      this.nextThinkingSeconds = THINKING_DELAYS[this.thinkingIndex];
      this.play('thinking');
    }
    this._syncDebugState();
  }

  getClipSummary() {
    return [...this.clips.entries()].map(([name, clip]) => ({
      name,
      duration: clip.duration,
      tracks: clip.tracks.length,
    }));
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.mixer.removeEventListener('finished', this._onFinished);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.model);
    this.actions.clear();
    this.clips.clear();
    this._syncDebugState({ includeClips: true });
  }

  _syncDebugState({ includeClips = false } = {}) {
    if (!this.anchor?.userData) return;
    this.anchor.userData.animationAssetsSettled = this.assetsSettled;
    this.anchor.userData.animationState = this.currentName;
    this.anchor.userData.animationInactivitySeconds = this.inactivitySeconds;
    this.anchor.userData.animationNextThinkingSeconds = this.nextThinkingSeconds;
    if (includeClips) this.anchor.userData.animationClipSummaries = this.getClipSummary();
  }
}
