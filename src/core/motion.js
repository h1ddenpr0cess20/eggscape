/** A damped spring, for squash and landing recoil. */
export function spring(s, k, c, dt, to = 0) {
  s.v += (to - s.p) * k * dt - s.v * c * dt;
  s.p += s.v * dt;
  return s.p;
}

/** Frame-rate independent chase towards a target. */
export function approach(value, target, rate, dt) {
  return value + (target - value) * Math.min(1, dt * rate);
}

export function clamp(value, lo, hi) {
  return Math.min(hi, Math.max(lo, value));
}
