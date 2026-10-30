// measure.js — 측정 연습: 3D 지그 + 계산한 J–V (one-diode model); 탠덤 3T = the tandem run + the T–M voltage probe (midRead, 10/26)
// Part 1: physics (no DOM). Everything here is plain numbers so it can be self-tested.
(function () {
'use strict';
const VT = 0.025693;                       // kT/q at 25 °C (V)
const PIN_F_STOP = 0.413;                  // N per pin at the hard stop (Mill-Max 0906-1, 0.9 mm)
const PIN_K = 0.35, PIN_F0 = 0.098;        // N/mm and preload at first touch (10 -> 60 g over 1.4 mm)
const SENSE_LIMIT = 1.0;                   // V per load lead that remote sense can make up (2400 spec, check)

// 예시 값 (illustrative): targets for the reverse scan of a correct run
const TRACKS = {
  single: { name: '싱글셀', target: { Voc: 1.20, Jsc: 20.0, FF: 0.80 }, n: 1.5, rshArea: 5000,
    aDev: 0.2345,          // whole pixel = Ag stripe x ITO band overlap, 6.7 x 3.5 mm (new_mask_0919)
    aMask: 0.0625,         // mask opening 2.5 x 2.5 mm
    rLead: 0.5,            // DB15 cable + rotary + banana leads + PCB trace, per side (assumed)
    vMin: -30, vMax: 3.5 },
  tandem: { name: '탠덤', target: { Voc: 1.90, Jsc: 19.5, FF: 0.78 }, n: 2.4, rshArea: 3000,
    aDev: 1.0, aMask: 1.0, // KIER 1 x 1 cm mask opening = active area
    rLead: 0.15,           // SMA–BNC 1 m + BNC–banana + PCB, per side (assumed)
    vMin: -30, vMax: 4.5 },
};
// 탠덤 3T (10/26): the same jig and T–B J–V as the tandem; the mid terminal (recombination ITO, 25 nm) is read as a voltage probe.
// sub: the two sub-cell diodes that split the terminal voltage (ASSUMED 예시: Voc 1.20 + 0.70 = the tandem 1.90, same photocurrent);
// rLat: lateral ITO resistance from the active area to the corner pad if current is forced through M (60–120 Ω/sq -> 70–290 Ω, 150 Ω taken).
// The two ideality factors add up to the tandem's n (1.5 + 0.9 = 2.4) and the two Voc to its Voc (1.20 + 0.70 = 1.90), so the series pair is the tandem diode.
TRACKS.tandem3t = Object.assign({}, TRACKS.tandem, { name: '탠덤 3T', sub: { pvk: { Voc: 1.20, n: 1.5 }, si: { Voc: 0.70, n: 0.9 }, rLat: 150, aSmall: 0.04 } });

// contact resistance of one pin vs force: 20 mΩ at full force (Mill-Max spec) plus a surface-film
// term that grows fast at light force (ASSUMED shape and size: for practice only, not measured)
function pinR(F) { if (!(F > 0)) return Infinity; return 0.02 + 2e4 * Math.exp(-F / 0.035); }
function par() { let g = 0; for (const r of arguments) if (isFinite(r)) g += 1 / r; return g > 0 ? 1 / g : Infinity; }

// deterministic noise
function rng(seed) { let a = seed >>> 0; return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
  t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ---- device: I(Vd) = Iph - I0 (exp(Vd/nVt) - 1) - Vd/Rsh ; V = Vd - I Rs - Vloss(I)  (generator sign)
// For each terminal V the cell current is found by bisection on Vd (g is monotonic, so it always converges).
function solveI(dev, Vterm, vloss) {
  const nvt = dev.n * VT;
  const I = (vd) => dev.Iph - dev.I0 * Math.expm1(vd / nvt) - vd / dev.Rsh;
  const g = (vd) => { const i = I(vd); return vd - i * dev.Rs - vloss(i) - Vterm; };
  let lo = dev.vMin, hi = dev.vMax;
  if (g(lo) > 0) return I(lo); if (g(hi) < 0) return I(hi);
  for (let k = 0; k < 90; k++) { const m = 0.5 * (lo + hi); if (g(m) > 0) hi = m; else lo = m; }
  return I(0.5 * (lo + hi));
}
function ffOf(dev, aMask) {   // intrinsic curve: Voc, Jsc (mA/cm2), FF
  const z = () => 0; const isc = solveI(dev, 0, z);
  let lo = 0, hi = dev.vMax; for (let k = 0; k < 70; k++) { const m = (lo + hi) / 2; if (solveI(dev, m, z) > 0) lo = m; else hi = m; }
  const voc = lo; let pm = 0; for (let k = 1; k < 400; k++) { const v = voc * k / 400; pm = Math.max(pm, v * solveI(dev, v, z)); }
  return { Voc: voc, Jsc: isc / aMask * 1000, FF: pm / (voc * isc) };
}
// fit Iph, I0, Rs so the correct run gives the 예시 값
function calibrate(key) {
  const T = TRACKS[key], t = T.target, nvt = T.n * VT, Rsh = T.rshArea / T.aDev;
  const isc = t.Jsc / 1000 * T.aMask;
  const build = (Rs) => { let Iph = isc, I0 = 1e-15;
    for (let k = 0; k < 8; k++) { I0 = (Iph - t.Voc / Rsh) / Math.expm1(t.Voc / nvt); const vd = isc * Rs; Iph = isc + I0 * Math.expm1(vd / nvt) + vd / Rsh; }
    return { Iph, I0, Rs, Rsh, n: T.n, vMin: T.vMin, vMax: T.vMax }; };
  let lo = 0, hi = 0.5 * t.Voc / isc;
  for (let k = 0; k < 60; k++) { const m = (lo + hi) / 2; if (ffOf(build(m), T.aMask).FF > t.FF) lo = m; else hi = m; }
  return build((lo + hi) / 2);
}
const DEV = { single: calibrate('single'), tandem: calibrate('tandem'), tandem3t: calibrate('tandem3t') };

// ---- the state a practice run is built from
function defaultState(track, bl) {   // bl: beamline cell v3 (10/30); the production state keeps its old keys (its noise seed hashes the state)
  const s = defaultState0(track); if (bl) { s.bl = true; s.blm = null; } return s;
}
function defaultState0(track) {
  return { track, station: null, cell: null, mask: null, ring: null, lid: 'open', knobs: [-1, -1],
    db15: false, rotary: 0, jacks: { HI: '', LO: '', SHI: '', SLO: '' },
    pc: { connected: false, fourWire: false, vStart: -0.1, vStop: 1.3, step: 0.01, delay: 50, dir: 'both', comp: 10, area: '' },
    light: { lamp: false, shutter: false, level: 0.93, refRead: null },
    mid: { window: null, pad: null, mode: null, chain: false } };   // 3T only: wiped corner, what is under the mid pins, where M-F/M-S go, multimeter chain check
}
function correctState(track, bl) {   // bl: beamline cell v3 (10/30)
  const s = defaultState(track, bl);
  s.station = 'ok'; s.cell = track === 'single' ? 'down' : 'up'; s.mask = 'ok';
  if (track === 'single') { s.ring = 'in'; s.lid = 'closed'; s.db15 = true; s.rotary = 1; }
  else s.knobs = [1.8, 1.8];
  if (track === 'tandem3t') s.mid = { window: 'ok', pad: 'ag', mode: 'probe', chain: true };
  s.jacks = { HI: 'F+', LO: 'F-', SHI: 'S+', SLO: 'S-' };
  s.pc = { connected: true, fourWire: true, vStart: -0.1, vStop: track === 'single' ? 1.3 : 2.0, step: 0.01, delay: 50, dir: 'both',
    comp: track === 'single' ? 10 : 50, area: String(TRACKS[track].aMask) };
  s.light = { lamp: true, shutter: true, level: 1.0, refRead: 1.0 };
  if (bl) { s.blm = 'ok'; if (track === 'single') s.pc.area = String(TRACKS.single.aDev); }   // beamline single: no aperture mask -> whole pixel
  return s;
}

// pin forces (N) for each contact group
function pinForces(s) {
  if (s.track === 'single') {
    // glass is pressed by the lid through the press ring; without either, only its weight (1.7 g / 12 pins)
    const F = (s.lid === 'closed' && s.ring === 'in') ? PIN_F_STOP : 0.0014;
    return { F, groups: { 'F+': [F, F], 'S+': [F, F], 'F-': [F], 'S-': [F] } };
  }
  // tandem: knob k turns after first touch -> 0.5 mm per turn (M3), stop at 0.9 mm (1.8 turns)
  const c = s.knobs.map((t) => Math.min(0.9, 0.5 * t));
  const at = (x, y) => { const u = (x + y) / 36 + 0.5; const cp = c[1] + (c[0] - c[1]) * u;   // knob 1 at (18,18), knob 2 at (-18,-18)
    return cp < 0 ? 0 : PIN_F0 + PIN_K * cp + (s.mask && s.mask !== 'none' ? 0.05 : 0); };   // KIER mask adds ~0.15 mm
  const ne = at(6.45, 6.45), sw = at(-6.45, -6.45), nw = at(-6.45, 6.45), se = at(6.45, -6.45);
  // front F+ NE·SW, S+ NW·SE; rear pins sit at the same xy, so the same force
  return { F: Math.min(ne, sw, nw, se), Fpin: { ne, sw, nw, se }, groups: { 'F+': [ne, sw], 'S+': [nw, se], 'F-': [ne, sw], 'S-': [nw, se] } };
}

// build the electrical picture of a state: what the 2400 sees
function circuit(s) {
  const T = TRACKS[s.track], dev0 = DEV[s.track], si = s.track === 'single', out = { open: false, why: [], runaway: false, pol: 1, notes: {} };
  const extraR = (!si && s.mask === 'rot') ? 30 : 0;    // pin on mask steel instead of the pad (ASSUMED 30 Ω)
  const pf = pinForces(s); out.forces = pf;
  const gR = (name) => par(...pf.groups[name].map((F) => pinR(F) + extraR));
  if (s.station == null) { out.open = true; out.why.push('nojig'); }
  if (s.cell == null) { out.open = true; out.why.push('nocell'); }
  if (si) {
    if (s.cell === 'up') { out.open = true; out.why.push('upside'); }
    if (!s.db15) { out.open = true; out.why.push('nodb15'); }
    if (!s.rotary) { out.open = true; out.why.push('rotaryoff'); }
    if (s.bl && s.rotary > 2) { out.open = true; out.why.push('blpixel'); }   // beamline v3 single: needles on P1S / P2S only
  }
  let polCell = 1;
  if (!si && s.cell === 'flip') polCell = -1;           // front pins on the Si-side (−) pads
  // leads: which jig lead is in which 2400 jack
  const J = s.jacks, sign = (l) => (l ? (l[1] === '+' ? 1 : -1) : 0);
  // 3T: an M lead in the 2400 loop would drive the cell current through the 25 nm recombination ITO -> never; treated as no T–B loop
  if (Object.values(J).some((l) => /^M-/.test(l || ''))) { out.open = true; out.why.push('midloop'); }
  if (!J.HI || !J.LO) { out.open = true; out.why.push('noforce'); }
  else if (sign(J.HI) === sign(J.LO)) { out.open = true; out.why.push('sameside'); }
  const polLead = sign(J.HI) || 1;
  out.pol = polLead * polCell; out.polLead = polLead; out.polCell = polCell;
  // series loss on each side: force path = pins of the lead in HI/LO + cable
  const side = (forceLead, senseLead) => {
    if (!forceLead) return null;
    if (/^M-/.test(forceLead)) return { open: true };                   // M is not a T–B force path
    const Rf = gR(forceLead) + T.rLead;
    if (!isFinite(Rf)) return { open: true };
    const senseOk = s.pc.fourWire && senseLead && !/^M-/.test(senseLead) && sign(senseLead) === sign(forceLead) && isFinite(gR(senseLead));
    // remote sense makes up the lead drop up to SENSE_LIMIT; without sense (2-wire, or sense lead missing:
    // ASSUMED to fall back to the force side inside the 2400) the whole drop stays in the curve
    return { Rf, sense: senseOk, loss: (i) => { const d = Math.abs(i) * Rf; return Math.sign(i) * (senseOk ? Math.max(0, d - SENSE_LIMIT) : d); } };
  };
  const plus = side(J.HI, J.SHI), minus = side(J.LO, J.SLO);
  if ((plus && plus.open) || (minus && minus.open)) { out.open = true; out.why.push('nocontact'); }
  if (s.pc.fourWire && J.HI && J.SHI && !out.why.includes('midloop') && sign(J.SHI) !== sign(J.HI)) out.runaway = true;    // sense reversed: loop runs away
  if (s.pc.fourWire && (!J.SHI || !J.SLO)) out.notes.senseMissing = true;
  out.loss = (i) => (plus && !plus.open ? plus.loss(i) : 0) + (minus && !minus.open ? minus.loss(i) : 0);
  out.Rext = (plus && plus.Rf || 0) + (minus && minus.Rf || 0);
  out.senseBoth = !!(plus && plus.sense && minus && minus.sense);
  // light reaching the cell
  let L = s.light.lamp && s.light.shutter ? s.light.level : 0;
  if (s.station === 'tilt') L *= 0.97;                                  // off its seat: off the beam centre (ASSUMED −3 %)
  let aIll = T.aMask;
  if (si) { if (s.bl) aIll = T.aDev;   // beamline v3 single: no aperture mask, the whole pixel under the 20 x 20 frame window is lit
    else { if (s.mask === 'shift') aIll = 0.6 * T.aMask; if (s.mask === 'none') aIll = T.aDev; } }
  else { if (s.mask === 'none') aIll = 1.05 * T.aMask;                 // light past the 1 cm edge (ASSUMED +5 %)
    if (s.mask === 'rot') aIll = 0.92 * T.aMask;                        // rotated pair shades a corner (ASSUMED 8 %)
    if (s.cell === 'flip') L *= 0.02; }                                  // light enters Si first: PVK (limiting) cell starves (ASSUMED 2 %)
  out.light = L; out.aIll = aIll;
  out.dev = Object.assign({}, dev0, { Iph: dev0.Iph * L * aIll / T.aMask });
  return out;
}

// one J–V run: reverse (Voc -> Jsc) then forward, like the lab program
function simulate(s) {
  const T = TRACKS[s.track], p = s.pc, res = { ok: true, err: null, scans: [] };
  if (!p.connected) return { ok: false, err: 'PC가 키슬리에 연결되지 않았습니다 (6단계 “연결”).' };
  const area = parseFloat(p.area);
  if (!(area > 0)) return { ok: false, err: '면적(cm²)을 넣어야 J를 계산합니다 (6단계).' };
  const step = Math.abs(parseFloat(p.step)), v0 = parseFloat(p.vStart), v1 = parseFloat(p.vStop), comp = parseFloat(p.comp) / 1000;
  if (!(step > 0) || !(v1 > v0) || !(comp > 0)) return { ok: false, err: '스윕 설정을 확인하세요 (시작 < 끝, 간격·compliance > 0).' };
  const npt = Math.min(600, Math.floor((v1 - v0) / step + 1e-9) + 1), V = [];
  for (let k = 0; k < npt; k++) V.push(+(v0 + k * step).toFixed(4));
  const c = circuit(s); res.circuit = c;
  const r = rng(hash(JSON.stringify(s)));
  // hysteresis (ASSUMED, simple): forward scan has higher J0 and Rs; it fades for slow scans (long delay)
  const h = 0.04 / (1 + (parseFloat(p.delay) || 0) / 200);
  const chatter = s.track !== 'single' ? c.forces.F < 0.2 && c.forces.F > 0 : c.forces.F < 0.01;
  const run = (dir) => {
    const dev = Object.assign({}, c.dev);
    if (dir === 'fwd') { dev.I0 *= Math.exp(0.4 * h * T.target.Voc / (dev.n * VT)); dev.Rs *= 1 + 4 * h; }
    const vs = dir === 'rev' ? V.slice().reverse() : V.slice(), pts = [];
    for (const v of vs) {
      let i;   // current out of the cell's + terminal (generator sign), A
      if (c.runaway) i = -comp;
      else if (c.open) i = 0;
      else {
        i = solveI(dev, c.pol * v, c.loss);
        if (chatter && r() < 0.18) i *= 0.2 + 0.6 * r();   // pins lift and land again (light force)
        i = c.pol * i;                                      // what the 2400 sees, as generated current
      }
      i += (1e-9 + 2e-5 * Math.abs(i)) * gauss(r);          // meter noise
      if (Math.abs(i) > comp) i = Math.sign(i) * comp;     // compliance clips the current
      pts.push({ v, j: i / area * 1000 });                 // mA/cm2, J positive = power out
    }
    pts.sort((a, b) => a.v - b.v);
    return { dir, pts, fig: extract(pts) };
  };
  const dirs = p.dir === 'both' ? ['rev', 'fwd'] : [p.dir];
  for (const d of dirs) res.scans.push(run(d));
  res.area = area; res.comp = comp; res.h = h;
  if (s.track === 'tandem3t') res.mid = midRead(s, c, res);
  return res;
}

// 3T: what the voltage probe on M reads along the reverse scan (예시, ASSUMED: the tandem junction voltage Vd = V + I·Rs + lead drop is shared by
// two series diodes with the same excess current x: Vd = n1 kT/q ln(1 + x/I01) + n2 kT/q ln(1 + x/I02), I0k from each sub-cell Voc at the same
// photocurrent; V_pvk is the first term). The reading is V_pvk when M carries no current (probe); + I·rLat (volts) when the cell current is forced
// through M; 0 when the wrong corner was wiped (M sits on IZO = T). V_si = V - V_pvk.
function midRead(s, c, res) {
  const T = TRACKS[s.track], sub = T.sub, m = s.mid, dev = c.dev, area = res.area;
  const nvt = (k) => sub[k].n * VT, I0 = { pvk: dev.Iph / Math.expm1(sub.pvk.Voc / nvt('pvk')), si: dev.Iph / Math.expm1(sub.si.Voc / nvt('si')) };
  const Vsum = (x) => nvt('pvk') * Math.log(1 + x / I0.pvk) + nvt('si') * Math.log(1 + x / I0.si);
  const vPvk = (Vd) => { let lo = -Math.min(I0.pvk, I0.si) * (1 - 1e-9), hi = Math.max(dev.Iph, 1e-6) * 10;    // Vsum is monotonic in x
    for (let k = 0; k < 140; k++) { const mid = (lo + hi) / 2; if (Vsum(mid) > Vd) hi = mid; else lo = mid; }
    return nvt('pvk') * Math.log(1 + (lo + hi) / 2 / I0.pvk); };
  const sc = res.scans[0], pts = sc.pts;
  const pick = (f) => pts.reduce((a, b) => (f(b) > f(a) ? b : a));
  const atJsc = pick((p) => -Math.abs(p.v)), atVoc = pick((p) => -Math.abs(p.j)), atMpp = pick((p) => (p.v > 0 && p.j > 0 ? p.v * p.j : -1));
  const read = (p) => {
    const I = p.j * area / 1000, vp = c.open ? 0 : vPvk(p.v + I * dev.Rs + (c.loss ? c.loss(I) : 0));
    let Vread = vp, err = 0;
    if (m.window === 'key') Vread = 0;                                  // M on the un-wiped top electrode: shorted to T
    else if (m.mode === 'drive') { err = Math.abs(I) * sub.rLat; Vread = vp + err; }   // cell current through the ITO: lateral drop adds
    else if (m.mode == null) Vread = null;
    return { V: p.v, J: p.j, Vpvk: vp, Vsi: p.v - vp, Vread, err };
  };
  const iSmall = (sc.fig.Jsc || 0) / 1000 * sub.aSmall;                  // Si Jsc with a 2 x 2 mm illumination spot through M–B
  return { atJsc: read(atJsc), atMpp: read(atMpp), atVoc: read(atVoc), small: { I: iSmall, drop: iSmall * sub.rLat, a: sub.aSmall },
    dropFull: (sc.fig.Jsc || 0) / 1000 * area * sub.rLat };
}

function extract(pts) {
  const f = { Voc: null, Jsc: null, FF: null, PCE: null };
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    if (f.Jsc == null && a.v <= 0 && b.v >= 0) f.Jsc = a.j + (b.j - a.j) * (0 - a.v) / ((b.v - a.v) || 1);
  }
  if (f.Jsc == null || f.Jsc <= 0.05) return f;
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1], b = pts[k];
    if (a.v >= 0 && a.j > 0 && b.j <= 0) { f.Voc = a.v + (b.v - a.v) * a.j / (a.j - b.j); break; }
  }
  if (f.Voc == null || f.Voc <= 0) { f.Voc = null; return f; }
  let pm = 0; for (const q of pts) if (q.v >= 0 && q.v <= f.Voc) pm = Math.max(pm, q.v * q.j);
  f.FF = pm / (f.Voc * f.Jsc); f.PCE = pm;     // mW/cm2 at 100 mW/cm2 = %
  return f;
}

window.JV = { VT, TRACKS, DEV, pinR, pinForces, circuit, simulate, midRead, extract, defaultState, correctState, SENSE_LIMIT, PIN_F_STOP };
})();

// Part 2: what went wrong (Korean, one or two sentences each) and the self-test
(function () {
'use strict';
const J = window.JV, f1 = (x, d) => (x == null || !isFinite(x) ? '–' : x.toFixed(d));

const REF = {};
function refFig(t, bl) { const k = t + (bl ? ':bl' : ''); return REF[k] || (REF[k] = J.simulate(J.correctState(t, bl)).scans[0].fig); }
function diagnose(s, res) {
  const T = J.TRACKS[s.track], c = res.circuit, msg = [], why = c.why, A = s.bl && s.track === 'single' ? T.aDev : T.aMask;
  const ref = refFig(s.track, s.bl), rev = res.scans[0].fig;
  const add = (t) => msg.push(t);
  if (why.includes('nojig')) add('지그를 스테이션에 올리지 않았습니다. 지그가 없으니 잴 것이 없습니다.');
  if (why.includes('nocell')) add('셀을 넣지 않아 핀이 아무것도 누르지 않습니다 → 전류 0, 잡음만.');
  if (why.includes('upside')) add('셀을 뒤집어 넣어(막면이 위) 핀이 유리 뒷면에 닿았습니다 → 회로가 열려 잡음만 나옵니다.');
  if (why.includes('nodb15')) add('DB15 케이블을 스위치 박스에 꽂지 않았습니다 → 회로가 열려 잡음만 나옵니다.');
  if (why.includes('blpixel')) add('빔라인 셀 v3 싱글은 바늘이 P1·P2 화소(P1S·P2S)에만 닿습니다 → 로터리 P3·P4는 열린 회로라 잡음만 나옵니다.');
  if (why.includes('rotaryoff')) add('스위치 박스 로터리가 OFF라 어느 화소도 키슬리에 붙지 않았습니다 → 잡음만.');
  if (why.includes('noforce')) add('키슬리 HI 또는 LO에 F 선이 없습니다. 전류가 흐를 길이 없어 잡음만 나옵니다.');
  if (why.includes('sameside')) add('HI와 LO에 같은 쪽(+끼리 또는 −끼리) 선을 꽂아 셀을 거치지 않습니다 → 잡음만.');
  if (why.includes('nocontact')) add('핀이 패드에 닿지 않은 쪽이 있어(노브가 핀 닿기 전) 회로가 열렸습니다.');
  if (why.includes('midloop')) add('M-F/M-S를 키슬리 2400 루프에 꽂았습니다 → 셀 전류가 25 nm 재결합 ITO를 가로질러 M으로 흐릅니다. 금지: M은 전압 읽기 전용(I ≈ 0)이고, T–B 루프는 F+/S+·F−/S−로만. (연습에서는 T–B 루프가 없는 것으로 봅니다.)');
  if (c.runaway) add('센스 선을 반대로 꽂아(SENSE HI에 − 쪽) 키슬리가 전압을 거꾸로 맞추다 끝까지 달아납니다 → 전류가 compliance에 붙습니다. 실제로는 셀이 상할 수 있습니다.');
  if (!c.open && !c.runaway && c.polLead < 0) add('F+/F−를 HI/LO에 반대로 꽂아 극성이 바뀌었습니다 → 곡선이 뒤집혀(전류 음수) Voc를 못 찾습니다.');
  if (s.track !== 'single' && s.cell === 'flip') add('웨이퍼를 뒤집어 넣어 앞 핀이 Si 쪽 패드에 닿았고(극성 반대), 빛이 Si를 먼저 지나 전류를 제한하는 PVK 쪽에 거의 오지 않습니다(가정 2 %).');
  if (!(s.light.lamp && s.light.shutter)) add('램프가 꺼졌거나 셔터가 닫혀 dark 곡선입니다: Jsc ≈ 0, 순바이어스에서만 전류가 커집니다.');
  else if (Math.abs(s.light.level - 1) > 0.015) add('기준 셀로 1 sun을 맞추지 않아 빛이 ' + f1(s.light.level, 2) + ' sun입니다 → Jsc가 그 비율만큼, Voc는 조금(nkT/q·ln) 바뀝니다.');
  if (s.station === 'tilt') add('지그가 강구 홈에 덜 앉아 셀이 빛 가운데에서 비켜났습니다 → 빛이 조금 약합니다(가정 −3 %).');
  if (s.track === 'single') {
    if (s.mask === 'none') add('마스크가 없어 화소 전체(약 ' + f1(T.aDev, 3) + ' cm², 패턴 치수)가 빛을 받는데 ' + f1(parseFloat(s.pc.area), 4) + ' cm²로 나눴습니다 → Jsc가 실제보다 크게 나옵니다. 마스크 밖 면적 때문에 Voc도 조금 올라갑니다.');
    if (s.mask === 'shift') add('마스크가 어긋나 구멍의 약 40 %가 화소 밖에 놓였습니다 → 빛 받는 면적이 줄어 Jsc가 낮습니다(면적은 0.0625로 나눴으므로).');
    if (s.ring !== 'in') add('누름 링을 빼먹어 뚜껑이 1.1T 유리에 닿지 않습니다 → 핀 힘이 유리 무게뿐(핀당 약 1 mN)이라 접촉이 불안정합니다.');
    if (s.lid !== 'closed') add('뚜껑 걸쇠가 안 걸려 유리를 누르지 못합니다 → 핀 접촉 저항이 수 kΩ(가정)으로 커져 곡선이 꺾이거나 튑니다.');
  } else {
    const t = s.knobs, Fm = c.forces.F;
    if (t[0] < 1.75 || t[1] < 1.75) add('노브가 멈춤까지 덜 조여졌습니다(노브 1 ' + f1(t[0], 1) + ', 노브 2 ' + f1(t[1], 1) + ' / 1.8바퀴) → 가장 약한 핀 ' + f1(Fm, 2) + ' N, 접촉 저항 약 ' + f1(J.pinR(Fm), Fm > 0.25 ? 2 : 0) + ' Ω(가정 곡선).');
    if (s.mask === 'rot') add('마스크 쌍이 돌아가 핀이 구멍 대신 마스크 금속을 누릅니다 → 접촉 저항이 커지고(가정 30 Ω) 창 모서리가 가려집니다.');
    if (s.mask === 'none') add('KIER 마스크 없이 재서 1 cm 창 밖 빛까지 들어옵니다 → Jsc가 조금 높습니다(가정 +5 %).');
  }
  if (s.track === 'tandem3t' && res.mid) {
    const m = s.mid, M = res.mid;
    if (m.window === 'key') add('키 모서리(+x,+y)를 닦았습니다. TT3의 M 핀은 대각 반대 (−x,−y)에 있어 닦지 않은 IZO 위에 앉습니다 → M = T, T–M 읽기 0 V. 사슬 점검에서 M ↔ F+가 단락으로 나옵니다.');
    else if (m.window == null) add('창을 닦았는지 고르지 않았습니다. 장착 전 키 대각 반대 모서리 4.4 mm 창의 상부셀 스택을 DMF 면봉으로 걷어내야 M 핀이 재결합 ITO(패드)에 닿습니다.');
    if (m.pad === 'bare') add('mid 핀을 맨 ITO에 바로 댔습니다. 전류 0 읽기라 지금 값에는 영향이 없지만(가정) 25 nm ITO는 0.72 N 왕관 팁의 반복 장착에서 뚫립니다 → Ag mid 패드 또는 Ag 페이스트 점, 아니면 M1·M2만 둥근 팁·낮은 하중 핀.');
    else if (m.pad == null) add('mid 핀 아래가 무엇인지 고르지 않았습니다 (Ag 패드 / Ag 페이스트 / 맨 ITO).');
    if (m.mode === 'drive') add('M–B로 1 cm² 전체의 전류를 흘렸습니다 → 재결합 ITO 가로 전압강하 I·R ≈ ' + f1(M.dropFull, 2) + ' V(약 150 Ω 가정)가 T–M 읽기에 더해져 V_PVK를 쓸 수 없고 면적 안 전압이 고르지 않습니다. 하지 말 것: 서브셀 Jsc는 소면적 조명으로만.');
    else if (m.mode == null) add('M-F·M-S를 어디에 꽂을지 고르지 않았습니다 (고임피던스 전압 읽기 = T–M V_PVK).');
    if (!m.chain) add('멀티미터 사슬 점검을 건너뛰었습니다: M-F ↔ M-S 수십 Ω(ITO), M ↔ F+(위 패드) 단락 아님, M ↔ F−(아래) 열림(다이오드만)을 먼저 봐야 창·패드가 맞는지 압니다.');
  }
  if (!c.open && !c.runaway) {
    if (!s.pc.fourWire) add('2선 측정이라 핀·케이블 저항 약 ' + f1(c.Rext, 2) + ' Ω이 직렬로 들어갑니다. 전류가 큰 탠덤(약 20 mA)에서 FF가 더 떨어집니다.');
    else if (c.notes.senseMissing) add('4선을 켰지만 센스 선 하나가 빠졌습니다. 그쪽은 2선처럼 선·핀 저항이 남는다고 보았습니다(가정: 기종에 따라 출력이 튈 수 있음).');
    else if (c.Rext > 3) add('핀 접촉 저항이 ' + f1(c.Rext, 0) + ' Ω으로 크지만 4선이 키슬리 사양 한도(선당 ' + J.SENSE_LIMIT + ' V)까지는 빼 줍니다. 넘는 만큼은 곡선에 남습니다.');
  }
  const a = parseFloat(s.pc.area);
  if (Math.abs(a - A) / A > 0.01) add('면적을 ' + a + ' cm²로 넣었는데 ' + (s.bl && s.track === 'single' ? '빛 받는 화소 전체는 ' : '마스크 구멍은 ') + A + ' cm²입니다 → J가 ' + f1(A / a, 2) + '배로 나옵니다.');
  const iscTrue = ref.Jsc / 1000 * A;
  const hitComp = res.scans.some((sc) => sc.pts.some((q) => Math.abs(q.j) * res.area / 1000 >= res.comp * 0.999));
  if (hitComp && !c.runaway && res.comp < iscTrue * 0.98) add('compliance ' + f1(res.comp * 1000, 1) + ' mA가 단락 전류 약 ' + f1(iscTrue * 1000, 2) + ' mA보다 작아 전류가 잘렸습니다.');
  if (parseFloat(s.pc.vStop) < ref.Voc) add('스윕 끝 전압(' + s.pc.vStop + ' V)이 Voc(약 ' + f1(ref.Voc, 2) + ' V)보다 낮아 Voc와 FF를 못 구합니다.');
  if (parseFloat(s.pc.vStart) > 0) add('스윕이 0 V 위에서 시작해 Jsc를 못 읽습니다.');
  if (!msg.length) {
    if (rev.Voc && Math.abs(rev.Voc - ref.Voc) / ref.Voc < 0.02 && Math.abs(rev.FF - ref.FF) < 0.02) add('제대로 연결됐습니다. 역방향 값이 예시 값과 같고, 순방향과의 차이는 히스테리시스(가정)입니다.');
    else add('설정은 맞지만 값이 예시와 다릅니다. 스윕 간격·지연을 확인하세요.');
    if (s.track === 'tandem3t' && res.mid) {
      const M = res.mid;
      if (s.mid.mode === 'probe') add('3T: T–M을 전류 0으로 읽어 V_PVK = Voc점 ' + f1(M.atVoc.Vread, 2) + ' V · MPP ' + f1(M.atMpp.Vread, 2) + ' V · Jsc점 ' + f1(M.atJsc.Vread, 2) + ' V (예시: 서브셀 다이오드 가정). ITO 면저항·접촉 저항은 들어오지 않습니다.');
      if (s.mid.mode === 'si') add('3T: M–B Si Jsc는 소면적 조명(' + Math.sqrt(M.small.a) * 10 + ' × ' + Math.sqrt(M.small.a) * 10 + ' mm)으로만 — 전류 약 ' + f1(M.small.I * 1000, 2) + ' mA, 가로 전압강하 I·R ≈ ' + f1(M.small.drop, 2) + ' V(150 Ω 가정) → 역바이어스로 보상. 전면적이면 ' + f1(M.dropFull, 1) + ' V라 불가.');
    }
  }
  return msg;
}

// self-test: the correct run hits the 예시 값; each mistake moves the numbers the right way
function selfTest() {
  const out = [], C = J.correctState;
  const run = (s) => J.simulate(s).scans[0].fig;
  const check = (name, ok, info) => out.push({ name, ok: !!ok, info });
  for (const t of ['single', 'tandem']) {
    const T = J.TRACKS[t].target, f = run(C(t));
    check(t + ': 바른 순서 = 예시 값 (±2 %)', f.Voc && Math.abs(f.Voc / T.Voc - 1) < 0.02 && Math.abs(f.Jsc / T.Jsc - 1) < 0.02 && Math.abs(f.FF / T.FF - 1) < 0.02,
      'Voc ' + f1(f.Voc, 3) + ' Jsc ' + f1(f.Jsc, 2) + ' FF ' + f1(f.FF, 3));
  }
  const S0 = run(C('single')), T0 = run(C('tandem'));
  const mod = (t, fn) => { const s = C(t); fn(s); return run(s); };
  let f;
  f = mod('single', (s) => { s.lid = 'half'; }); check('싱글 뚜껑 덜 닫힘 → FF↓ 또는 Jsc↓', f.FF == null || f.FF < S0.FF - 0.03 || f.Jsc < 0.5 * S0.Jsc, 'Jsc ' + f1(f.Jsc, 2) + ' FF ' + f1(f.FF, 3));
  f = mod('single', (s) => { s.ring = 'out'; }); check('싱글 누름 링 없음 → FF↓ 또는 Jsc↓', f.FF == null || f.FF < S0.FF - 0.03 || f.Jsc < 0.5 * S0.Jsc, 'Jsc ' + f1(f.Jsc, 2) + ' FF ' + f1(f.FF, 3));
  f = mod('single', (s) => { s.cell = 'up'; }); check('싱글 셀 뒤집힘 → 잡음만', f.Jsc == null || Math.abs(f.Jsc) < 0.05, 'Jsc ' + f1(f.Jsc, 4));
  f = mod('single', (s) => { s.rotary = 0; }); check('싱글 로터리 OFF → 잡음만', f.Jsc == null || Math.abs(f.Jsc) < 0.05, 'Jsc ' + f1(f.Jsc, 4));
  f = mod('single', (s) => { s.mask = 'none'; }); check('싱글 마스크 없음 → Jsc↑', f.Jsc > 1.5 * S0.Jsc, 'Jsc ' + f1(f.Jsc, 2));
  f = mod('single', (s) => { s.mask = 'shift'; }); check('싱글 마스크 어긋남 → Jsc↓', f.Jsc < 0.8 * S0.Jsc, 'Jsc ' + f1(f.Jsc, 2));
  f = mod('single', (s) => { s.pc.comp = 1; }); check('싱글 compliance 1 mA → Jsc 잘림', f.Jsc <= 16.1, 'Jsc ' + f1(f.Jsc, 2));
  f = mod('single', (s) => { s.pc.area = '0.1'; }); check('싱글 면적 0.1 → Jsc↓', f.Jsc < 0.7 * S0.Jsc, 'Jsc ' + f1(f.Jsc, 2));
  f = mod('single', (s) => { s.light.level = 0.93; }); check('싱글 빛 0.93 sun → Jsc↓', f.Jsc < 0.95 * S0.Jsc && f.Jsc > 0.9 * S0.Jsc, 'Jsc ' + f1(f.Jsc, 2));
  f = mod('single', (s) => { s.light.shutter = false; }); check('싱글 셔터 닫힘 → dark', f.Jsc == null || Math.abs(f.Jsc) < 0.05, 'Jsc ' + f1(f.Jsc, 4));
  f = mod('single', (s) => { s.jacks = { HI: 'F-', LO: 'F+', SHI: 'S-', SLO: 'S+' }; }); check('싱글 극성 반대 → 곡선 뒤집힘', f.Voc == null && J.simulate((() => { const s = C('single'); s.jacks = { HI: 'F-', LO: 'F+', SHI: 'S-', SLO: 'S+' }; return s; })()).scans[0].pts.some((p) => p.v > 0.2 && p.j < -10), 'Voc ' + f1(f.Voc, 3));
  f = mod('single', (s) => { s.pc.vStop = 1.0; }); check('싱글 스윕 1.0 V까지 → Voc 없음', f.Voc == null, 'Voc ' + f1(f.Voc, 3));
  f = mod('single', (s) => { s.jacks = { HI: 'S+', LO: 'S-', SHI: 'F+', SLO: 'F-' }; }); check('싱글 F·S 바꿔 꽂음 → 4선이면 그대로', Math.abs(f.FF - S0.FF) < 0.01, 'FF ' + f1(f.FF, 3));
  f = mod('tandem', (s) => { s.knobs = [0, 0]; }); check('탠덤 노브 핀 닿자마자 → FF↓', f.FF == null || f.FF < T0.FF - 0.03, 'FF ' + f1(f.FF, 3));
  f = mod('tandem', (s) => { s.knobs = [-0.5, -0.5]; }); check('탠덤 노브 핀 닿기 전 → 잡음만', f.Jsc == null || Math.abs(f.Jsc) < 0.05, 'Jsc ' + f1(f.Jsc, 4));
  const W2 = mod('tandem', (s) => { s.pc.fourWire = false; }); check('탠덤 2선 → FF↓', W2.FF < T0.FF - 0.003, 'FF ' + f1(W2.FF, 3));
  f = mod('tandem', (s) => { s.pc.fourWire = false; s.knobs = [0.8, 0.8]; }); check('탠덤 2선 + 노브 1바퀴 모자람 → FF가 2선보다 더↓', f.FF < W2.FF - 0.005, 'FF ' + f1(f.FF, 3));
  f = mod('tandem', (s) => { s.jacks.SHI = ''; }); check('탠덤 센스 HI 빠짐 → FF↓', f.FF < T0.FF - 0.001, 'FF ' + f1(f.FF, 3));
  f = mod('tandem', (s) => { s.mask = 'rot'; }); check('탠덤 마스크 돌아감 → Jsc↓', f.Jsc < 0.97 * T0.Jsc, 'Jsc ' + f1(f.Jsc, 2) + ' FF ' + f1(f.FF, 3));
  f = mod('tandem', (s) => { s.mask = 'none'; }); check('탠덤 마스크 없음 → Jsc↑', f.Jsc > 1.02 * T0.Jsc, 'Jsc ' + f1(f.Jsc, 2));
  f = mod('tandem', (s) => { s.pc.comp = 10; }); check('탠덤 compliance 10 mA → Jsc 잘림', f.Jsc <= 10.1, 'Jsc ' + f1(f.Jsc, 2));
  f = mod('tandem', (s) => { s.pc.vStop = 1.3; }); check('탠덤 싱글 설정(1.3 V) 그대로 → Voc 없음', f.Voc == null, 'Voc ' + f1(f.Voc, 3));
  f = mod('tandem', (s) => { s.cell = 'flip'; }); check('탠덤 웨이퍼 뒤집힘 → Voc 없음', f.Voc == null, 'Jsc ' + f1(f.Jsc, 3));
  f = mod('tandem', (s) => { s.jacks = { HI: 'F+', LO: 'F-', SHI: 'S-', SLO: 'S+' }; }); check('탠덤 센스 반대 → compliance', f.Voc == null, 'Jsc ' + f1(f.Jsc, 2));
  // 3T: the T–B curve is the tandem one; the M probe splits the voltage; every misuse of M shows
  const M0 = J.simulate(C('tandem3t')), m0 = M0.mid, T3 = J.TRACKS.tandem3t;
  check('3T: 바른 순서 = 탠덤 예시 값 (T–B)', Math.abs(M0.scans[0].fig.Voc / T3.target.Voc - 1) < 0.02 && Math.abs(M0.scans[0].fig.Jsc / T3.target.Jsc - 1) < 0.02, 'Voc ' + f1(M0.scans[0].fig.Voc, 3) + ' Jsc ' + f1(M0.scans[0].fig.Jsc, 2));
  check('3T 프로브: V_PVK(Voc점) ≈ 1.20, V_Si ≈ 0.70, V_PVK(Jsc점) ≈ 0', Math.abs(m0.atVoc.Vread - T3.sub.pvk.Voc) < 0.03 && Math.abs(m0.atVoc.Vsi - T3.sub.si.Voc) < 0.03 && Math.abs(m0.atJsc.Vread) < 0.1,
    'V_PVK ' + f1(m0.atVoc.Vread, 3) + ' V_Si ' + f1(m0.atVoc.Vsi, 3) + ' @Jsc ' + f1(m0.atJsc.Vread, 3));
  check('3T 프로브: MPP에서 0 < V_PVK < V', m0.atMpp.Vread > 0 && m0.atMpp.Vread < m0.atMpp.V, 'V_PVK ' + f1(m0.atMpp.Vread, 3) + ' / V ' + f1(m0.atMpp.V, 3));
  const modM = (fn) => { const s = C('tandem3t'); fn(s); return J.simulate(s); };
  let r = modM((s) => { s.mid.mode = 'drive'; }); check('3T M으로 전면적 전류 → 읽기 오차 > 1 V', r.mid.atJsc.err > 1 && r.mid.atJsc.Vread > r.mid.atJsc.Vpvk + 1, 'I·R ' + f1(r.mid.atJsc.err, 2) + ' V');
  r = modM((s) => { s.mid.window = 'key'; }); check('3T 키 모서리를 닦음 → T–M 0 V', r.mid.atVoc.Vread === 0 && r.scans[0].fig.Voc != null, 'V_read ' + f1(r.mid.atVoc.Vread, 2));
  r = modM((s) => { s.jacks.HI = 'M-F'; }); check('3T M-F를 2400 HI에 → 잡음만 (금지)', r.circuit.why.includes('midloop') && (r.scans[0].fig.Jsc == null || Math.abs(r.scans[0].fig.Jsc) < 0.05), 'Jsc ' + f1(r.scans[0].fig.Jsc, 4));
  r = modM((s) => { s.mid.mode = 'si'; }); check('3T 소면적 Si Jsc → 가로 강하 < 0.2 V, 전면적 > 1 V', r.mid.small.drop < 0.2 && r.mid.dropFull > 1, 'small ' + f1(r.mid.small.drop, 3) + ' full ' + f1(r.mid.dropFull, 2));
  // beamline cell v3 (10/30): the same devices; single = no aperture mask (whole pixel lit, area = pixel, so Voc a little above the masked run), needles on P1 / P2 only
  for (const t of ['single', 'tandem', 'tandem3t']) {
    const s = C(t, true), r2 = J.simulate(s), f2 = r2.scans[0].fig, T2 = J.TRACKS[t].target, msg = diagnose(s, r2);
    const vOk = t === 'single' ? f2.Voc >= S0.Voc - 0.005 && f2.Voc < S0.Voc + 0.1 : Math.abs(f2.Voc / T2.Voc - 1) < 0.02;
    const ffOk = t === 'single' ? f2.FF > T2.FF - 0.08 && f2.FF <= T2.FF + 0.005 : Math.abs(f2.FF - T2.FF) < 0.02;   // single: 3.75x the current through the same pixel Rs
    check('빔라인 셀 v3 ' + t + ': 바른 순서 → Jsc 예시 값, 진단 “제대로”', vOk && Math.abs(f2.Jsc / T2.Jsc - 1) < 0.02 && ffOk && /제대로/.test(msg[0] || ''),
      'Voc ' + f1(f2.Voc, 3) + ' Jsc ' + f1(f2.Jsc, 2) + ' FF ' + f1(f2.FF, 3) + ' · ' + (msg[0] || '').slice(0, 30));
  }
  f = run((() => { const s = C('single', true); s.rotary = 3; return s; })()); check('빔라인 셀 v3 싱글 P3 → 잡음만', f.Jsc == null || Math.abs(f.Jsc) < 0.05, 'Jsc ' + f1(f.Jsc, 4));
  const pass = out.filter((x) => x.ok).length;
  return { pass, total: out.length, results: out };
}
window.JV.diagnose = diagnose; window.JV.refFig = refFig; window.JV.selfTest = selfTest; window.measureSelfTest = selfTest;
})();

// Part 3: steps, controls and the 3D bench
(function () {
'use strict';
const J = window.JV, $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (x, d) => (x == null || !isFinite(x) ? '–' : x.toFixed(d));

const STEPS_PROD = {
  single: [['station', '지그 올리기'], ['cell', '셀 넣기'], ['mask', '마스크·링'], ['lid', '뚜껑 닫기'], ['wire', '선 연결'], ['pc', 'PC 설정'], ['light', '빛·기준 셀'], ['run', 'J–V 재기']],
  tandem: [['station', '지그 올리기'], ['mask', '마스크 쌍'], ['cell', '포켓에 넣기'], ['knob', '노브 조이기'], ['wire', '선 연결'], ['pc', 'PC 설정'], ['light', '빛·기준 셀'], ['run', 'J–V 재기']],
  tandem3t: [['station', '지그 올리기'], ['mask', '마스크 쌍 (3T)'], ['cell', '포켓에 넣기'], ['knob', '노브 조이기'], ['wire', 'T–B 선 연결'], ['mid', '3T: M 연결'], ['pc', 'PC 설정'], ['light', '빛·기준 셀'], ['run', 'J–V 재기']],
};
// beamline cell v3 (10/30): one mounting step instead of station / mask / lid / knobs
const STEPS_BL = {
  single: [['blmount', '셀 장착 (바늘 4)'], ['wire', '선 연결'], ['pc', 'PC 설정'], ['light', '빛·기준 셀'], ['run', 'J–V 재기']],
  tandem: [['blmount', '웨이퍼 장착 (핀 4 + 바늘 4)'], ['wire', '선 연결 (DB15)'], ['pc', 'PC 설정'], ['light', '빛·기준 셀'], ['run', 'J–V 재기']],
  tandem3t: [['blmount', '웨이퍼 장착 (바늘 6)'], ['wire', 'T–B 선 연결 (DB15)'], ['mid', '3T: M 연결'], ['pc', 'PC 설정'], ['light', '빛·기준 셀'], ['run', 'J–V 재기']],
};
let STEPS = STEPS_PROD;
const VIEW = { blmount: 'jig', station: 'jig', cell: 'jig', mask: 'jig', lid: 'jig', knob: 'jig', wire: 'bench', mid: 'bench', pc: 'keithley', light: 'lamp', run: 'bench' };
const LEADS = { single: { 'F+': 'F+ (ITO F)', 'S+': 'S+ (ITO S)', 'F-': 'F− (화소 F)', 'S-': 'S− (화소 S)' },
  tandem: { 'F+': 'F+ (윗판 SMA)', 'S+': 'S+ (윗판 SMA)', 'F-': 'F− (아랫판 SMA)', 'S-': 'S− (아랫판 SMA)' } };
LEADS.tandem3t = Object.assign({}, LEADS.tandem, { 'M-F': 'M-F (윗판 −y SMA, 3T mid)', 'M-S': 'M-S (윗판 −y SMA, 3T mid)' });
const LEADS_BL = { single: LEADS.single, tandem: { 'F+': 'F+ (앞 바늘, DB15)', 'S+': 'S+ (앞 바늘, DB15)', 'F-': 'F− (뒤 핀, DB15)', 'S-': 'S− (뒤 핀, DB15)' } };
LEADS_BL.tandem3t = Object.assign({}, LEADS_BL.tandem, { 'M-F': 'M-F (mid 바늘, DB15)', 'M-S': 'M-S (mid 바늘, DB15)' });
const JACKS = [['HI', 'HI'], ['LO', 'LO'], ['SHI', 'SENSE HI'], ['SLO', 'SENSE LO']];
const GLB = { single: 'single_prod', tandem: 'tandem_prod', tandem3t: 'tandem_prod_3t' };
const GLB_BL = { single: 'beamline_wc_single', tandem: 'beamline_wc_2t', tandem3t: 'beamline_wc_3t' };
// the single / 3T GLBs hold only the parts that differ from 2T; these 2T parts (GLTF-sanitised names) are shared
const WC_BASE = { beamline_wc_single: 'beamline_wc_2t', beamline_wc_3t: 'beamline_wc_2t' };
const WC_SHARED = {"beamline_wc_single": ["셀_몸체_Al_6061_흑색_아노다이징_70x66x10_R4_(포켓_31x31x45,_뒷면_평면_+_M4_x4_48x48,_뒷면_배선_홈)", "누름_틀_Al_10_40x40,_창_20x20_+_홈_6,_립_25x25_(05),_+X_15°_모따기,_M2_x4", "Kapton_005_(립_접촉면)", "M2x4_냄비머리_x4_(누름_틀)", "텐트_틀_Al_플랜지_10_(몸체_외곽_70x66,_안쪽_X_-285…249,_Z_±285)_+_벽_15,_5_앞,_+X는_벽_없이_15°_접힘", "CPI_필름_50_µm_텐트_창_(무색_폴리이미드;_대안_PET_12_µm),_틀에_접착", "M2x4_냄비머리_x4_(텐트_플랜지)", "가스_원터치_SMC_KQ2H04-M5_x2_(윗면_X_±19,_Ø2_→_앞면_Z+22로_텐트_안)", "커넥터_브래킷_Al_(밑판_26x18x2_+_판_57x17x2,_뒤로_8_돌출)_+_M3_x2", "M3x8_x2_(브래킷_→_몸체_윗면)", "DB15_(DA-15)_암_판넬형_(뒤_+Y로;_플랜지_391x125,_몸체_31x8x9_가정)", "SMA_판넬_잭_x2_(Ø635x8)", "배선_묶음_Ø29_(10가닥_접촉_8_+_예비_2;_뒷면_줄기_홈_→_윗면_→_DB15_뒤)", "Grace_새_세로판_60x120x7_(재출력,_레진_가정),_Ø45_x4_48x48,_위끝_=_웨이퍼_중심_+31", "Grace_2025_앵글_브래킷_\"angle_bracket_for_Ramen_holderSTEP\"_(형상_그대로;_X=z,_Y=x−6,_Z=y)", "M4x12_렌치볼트_x4_(판_뒤에서_몸체_M4_탭으로,_머리_Ø7x4)", "M4x16_볼트_+_너트_x4_(판_아래_구멍_↔_브래킷_세움판_Ø56_구멍_y_2953)"], "beamline_wc_3t": ["셀_몸체_Al_6061_흑색_아노다이징_70x66x10_R4_(포켓_31x31x45,_뒷면_평면_+_M4_x4_48x48,_뒷면_배선_홈)", "PEEK_인서트_(a)_탠덤_308x308x40,_웨이퍼_우물_253x253x055,_Mill-Max_0906-1_x4_(±645)_압입", "M2x6_인서트_고정_x2_(앞에서,_머리_Ø38_윗면_=_우물_바닥,_가정_DIN_912)", "스프링_핀_Mill-Max_0906-1_x4_(뒷면_패드_±645,_09_압축_=_072_N개)", "KIER_웨이퍼_25x25x05_(가정_03–05)", "KIER_뒷면_Ag_패드_Ø16_x4_(±645,_탠덤_v3_TB_핀_위치;_크기_가정)", "KIER_앞면_IZO_(마스크_사진_기준)", "KIER_앞면_Ag_(프레임_+_패드_Ø16_at_±643)", "KIER_앞면_MgF2", "M2x4_냄비머리_x4_(누름_틀)", "텐트_틀_Al_플랜지_10_(몸체_외곽_70x66,_안쪽_X_-285…249,_Z_±285)_+_벽_15,_5_앞,_+X는_벽_없이_15°_접힘", "CPI_필름_50_µm_텐트_창_(무색_폴리이미드;_대안_PET_12_µm),_틀에_접착", "M2x4_냄비머리_x4_(텐트_플랜지)", "가스_원터치_SMC_KQ2H04-M5_x2_(윗면_X_±19,_Ø2_→_앞면_Z+22로_텐트_안)", "커넥터_브래킷_Al_(밑판_26x18x2_+_판_57x17x2,_뒤로_8_돌출)_+_M3_x2", "M3x8_x2_(브래킷_→_몸체_윗면)", "DB15_(DA-15)_암_판넬형_(뒤_+Y로;_플랜지_391x125,_몸체_31x8x9_가정)", "SMA_판넬_잭_x2_(Ø635x8)", "배선_묶음_Ø29_(10가닥_접촉_8_+_예비_2;_뒷면_줄기_홈_→_윗면_→_DB15_뒤)", "Grace_새_세로판_60x120x7_(재출력,_레진_가정),_Ø45_x4_48x48,_위끝_=_웨이퍼_중심_+31", "Grace_2025_앵글_브래킷_\"angle_bracket_for_Ramen_holderSTEP\"_(형상_그대로;_X=z,_Y=x−6,_Z=y)", "M4x12_렌치볼트_x4_(판_뒤에서_몸체_M4_탭으로,_머리_Ø7x4)", "M4x16_볼트_+_너트_x4_(판_아래_구멍_↔_브래킷_세움판_Ø56_구멍_y_2953)"]};
const WC_HIDE = /^Grace|^M4x1[26] /, WC_SMP = /^KIER|^단일 셀|^3T mid 창|^3T Ag mid/;

const Sall = { prod: { single: J.defaultState('single'), tandem: J.defaultState('tandem'), tandem3t: J.defaultState('tandem3t') },
  bl: { single: J.defaultState('single', true), tandem: J.defaultState('tandem', true), tandem3t: J.defaultState('tandem3t', true) } };
const Lall = { prod: { single: null, tandem: null, tandem3t: null }, bl: { single: null, tandem: null, tandem3t: null } };
let jigMode = 'prod', track = 'single', S = Sall.prod, st = S.single, cur = 0, last = Lall.prod;

function done(id, s) {
  switch (id) {
    case 'blmount': return s.blm != null;
    case 'station': return s.station != null;
    case 'cell': return s.cell != null;
    case 'mask': return s.mask != null && (s.track === 'tandem' || s.ring != null);
    case 'lid': return s.lid !== 'open';
    case 'knob': return s.knobs[0] >= 0 && s.knobs[1] >= 0;
    case 'wire': return !!(s.jacks.HI && s.jacks.LO && s.jacks.SHI && s.jacks.SLO) && (s.track !== 'single' || (s.db15 && s.rotary));
    case 'mid': return s.mid.chain && s.mid.mode != null && s.mid.window != null && s.mid.pad != null;
    case 'pc': return s.pc.connected && parseFloat(s.pc.area) > 0;
    case 'light': return s.light.lamp && s.light.shutter && s.light.refRead != null;
    case 'run': return !!last[s.track];
  }
}
const opt = (path, v, text) => '<button class="opt" data-set="' + path + '" data-v="' + v + '" aria-pressed="' + (get(path) === v) + '">' + text + '</button>';
function get(path) { return path.split('.').reduce((o, k) => o[k], st); }
function set(path, v) { const ks = path.split('.'), k = ks.pop(); ks.reduce((o, q) => o[q], st)[k] = v; }

function cardHTML(id) {   // beamline cell v3: its own mounting card, DB15 wiring text, the rest = the production cards
  if (jigMode !== 'bl') return cardHTML0(id);
  const si = track === 'single', t3 = track === 'tandem3t', N = (cur + 1) + '. ';
  if (id === 'blmount') {
    const o = (v, t) => '<button class="opt" data-blmount="' + v + '" aria-pressed="' + (st.blm === v) + '">' + t + '</button>';
    return '<h2>' + N + '빔라인 셀에 장착 (' + (si ? '싱글' : t3 ? '탠덤 3T' : '탠덤 2T') + ')</h2><p>' + (si
      ? 'PEEK 인서트 (b)의 우물(깊이 1.15)에 유리를 막 면이 바깥(빔 쪽)으로 오게 넣고, Al 누름 틀(Kapton 0.05 립)을 M2 ×4로 조입니다. PEEK 블록의 BeCu 바늘 4개가 P1S·P2S와 ITO 두 곳에 닿습니다 (스프링 핀 없음).'
      : 'PEEK 인서트 (a)의 우물(깊이 0.55)에 웨이퍼를 PVK 쪽이 바깥(빔 쪽)으로 오게 넣으면 뒷면 스프링 핀 4개(±6.45)가 뒷면 패드에 닿고, Al 누름 틀을 M2 ×4로 조인 뒤 BeCu 바늘 4개가 앞 Ag 패드(±6.43)에 닿습니다.' +
        (t3 ? ' 3T: 3T 누름 틀(모서리 6×6 홈)과 mid 2바늘 블록이 M-F·M-S 패드에 닿습니다.' : '')) +
      ' 연습에서는 셀을 Grace 판에서 떼어 눕혀 램프 아래에 둡니다(연습용 배치). 접촉 힘은 제작 지그의 멈춤 값으로 계산합니다(예시).</p><div class="opts">' +
      o('ok', si ? '막 면 바깥 · 누름 틀 조임' : 'PVK 바깥 · 누름 틀 조임') + o('flip', si ? '유리를 뒤집어 넣음' : '웨이퍼 뒤집힘 (Si 쪽이 바깥)') + '</div>';
  }
  let h = cardHTML0(id);
  if (id === 'wire' && !si) h = '<h2>' + N + (t3 ? 'T–B 선 연결 (DB15)' : '선 연결 (DB15)') + '</h2><p>빔라인 셀은 바늘·핀 선 ' + (t3 ? '10' : '8') +
    '가닥이 몸체 뒷면 홈을 지나 DB15 하나로 나옵니다 (PCB 없음). DB15 분기 케이블(모델에 없음, 핀 배정 미정)에서 F+·S+(앞 바늘), F−·S−(뒤 핀)를 키슬리에: F+→HI, S+→SENSE HI, F−→LO, S−→SENSE LO.' +
    (t3 ? ' <b>M-F·M-S(mid 바늘)는 여기 꽂지 않습니다</b> — 다음 단계에서 전압계로.' : '') + '</p>' + h.slice(h.indexOf('<p class="label">키슬리'));
  if (id === 'wire' && si) h = h.replace('</p>', ' 빔라인 셀 v3 싱글은 바늘이 P1·P2에만 닿습니다 (로터리 P1·P2).</p>');
  if (id === 'mid') h = h.replace('(윗판 −y 변 SMA)', '(DB15, mid 바늘 2개)');
  if (id === 'pc' && si) h = h.replace('싱글: 마스크 구멍 2.5 × 2.5 mm', '빔라인 셀 싱글: 마스크 없음 → 화소 전체 ' + J.TRACKS.single.aDev + ' cm² (빛도 화소 전체 → 마스크 측정보다 Voc 조금 높고, 전류가 커져 FF 조금 낮음; 예시 계산)');
  return h;
}
function cardHTML0(id) {
  const T = J.TRACKS[track], si = track === 'single', t3 = track === 'tandem3t', N = (cur + 1) + '. ';
  switch (id) {
    case 'station': return '<h2>' + N + '지그를 스테이션에 올리기</h2><p>바닥 강구 3개가 스테이션 홈(MS3-10 두 개씩)에 들어가고 자석이 당기면 “딸깍” 앉습니다. 지그를 빼고 다시 올려도 같은 자리입니다.</p><div class="opts">' +
      opt('station', 'ok', '강구 3개를 홈에 맞춰 내려놓기') + opt('station', 'tilt', '대충 올림 (강구 하나가 홈 밖)') + '</div>';
    case 'cell': return si
      ? '<h2>' + N + '셀 넣기</h2><p>막면을 아래로 해 핀 12개 위에 놓습니다(교수님 “핀은 모두 bottom”). 자른 모서리를 포켓 키에 맞추면 유리가 0.8 mm 턱에 평평하게 앉습니다.</p><div class="opts">' +
        opt('cell', 'down', '막면 아래 · 자른 모서리 맞춤') + opt('cell', 'up', '막면 위로 (뒤집힘)') + '</div>'
      : '<h2>' + N + '포켓에 넣기</h2><p>마스크 쌍에 끼운 웨이퍼를 PVK 쪽을 위로, 자른 모서리를 키에 맞춰 아래 프레임 포켓에 넣습니다. 뒷핀 4개가 아래 마스크 구멍을 지나 뒷면 패드에 닿습니다.' +
        (t3 ? ' 3T: 키(+x+y)를 맞추면 닦은 창과 mid 패드가 그 대각 반대 (−x,−y), TT3의 M 핀 바로 아래에 옵니다.' : '') + '</p><div class="opts">' +
        opt('cell', 'up', 'PVK 위 · 모서리 키 맞춤') + opt('cell', 'flip', '뒤집힘 (Si 쪽이 위)') + '</div>';
    case 'mask': return si
      ? '<h2>' + N + '마스크와 누름 링</h2><p>0.1 mm 마스크(2.5 × 2.5 mm 구멍 4개 = 화소당 0.0625 cm²)를 유리 위에 놓고, 1.1T 유리면 누름 링을 얹습니다. 링이 있어야 뚜껑이 유리를 누릅니다.</p><p class="label">마스크</p><div class="opts">' +
        opt('mask', 'ok', '구멍을 화소에 맞춤') + opt('mask', 'shift', '1.5 mm 어긋남') + opt('mask', 'none', '빼먹음') + '</div><p class="label">누름 링</p><div class="opts">' +
        opt('ring', 'in', '넣음 (1.1T)') + opt('ring', 'out', '빼먹음') + '</div>'
      : '<h2>' + N + 'KIER 마스크 쌍에 웨이퍼 끼우기</h2><p>앞뒤 마스크(1 × 1 cm 창 + 핀 구멍 4개, ±6.45 mm)를 캡톤으로 붙인 쌍 사이에 웨이퍼를 넣습니다. 구멍 4개가 Ag 패드 4개(±6.43, Ø1.6) 위에 와야 합니다.' +
        (t3 ? ' 3T 앞 마스크에는 mid 패드 자리 (−10.4, −8.6)·(−8.6, −10.4)에 Ø2.0 구멍 2개가 더 있습니다.' : '') + '</p><div class="opts">' +
        opt('mask', 'ok', t3 ? '구멍 4 + 2 = 패드 4 + 2' : '구멍 4개 = 패드 4개') + opt('mask', 'rot', '마스크 쌍이 돌아감') + opt('mask', 'none', '마스크 없이') + '</div>';
    case 'lid': return '<h2>' + N + '뚜껑 닫기</h2><p>힌지 뚜껑을 내리면 +x 쪽 자석 걸쇠가 “딸깍” 붙습니다. 걸쇠 힘 13 N이 핀 12개(약 5 N)를 이깁니다. 3D에서 뚜껑을 눌러도 됩니다.</p><div class="opts">' +
      opt('lid', 'closed', '딸깍 닫기') + opt('lid', 'half', '덜 닫힘 (걸쇠 안 걸림)') + opt('lid', 'open', '열기') + '</div>';
    case 'knob': {
      const pf = J.pinForces(st), row = (k) => { const t = st.knobs[k];
        return '<div class="knob"><button class="btn ghost" data-knob="' + k + '" data-d="-0.5">−½</button><div><b>노브 ' + (k + 1) + '</b> <span class="mono">' + (t < 0 ? '핀 닿기 전 (' + f(-t, 1) + '바퀴 남음)' : f(t, 1) + ' / 1.8바퀴') + '</span>' +
          '<div class="meter"><i style="width:' + Math.max(0, Math.min(100, t / 1.8 * 100)) + '%"></i></div></div><button class="btn" data-knob="' + k + '" data-d="0.5">+½</button></div>'; };
      const fp = pf.Fpin || {};
      return '<h2>' + N + '노브 두 개 조이기</h2><p>노브(NOOSF3-14, M3)가 윗판 PCB를 기둥 멈춤까지 끌어내립니다. 핀이 닿은 뒤 1.8바퀴, ½바퀴에 핀당 약 0.09 N. 두 노브를 번갈아 조입니다. 3D에서 노브를 눌러도 ½바퀴씩 돕니다.</p>' + row(0) + row(1) +
        '<p class="mono">핀 힘 (N): NE ' + f(fp.ne, 2) + ' · NW ' + f(fp.nw, 2) + ' · SE ' + f(fp.se, 2) + ' · SW ' + f(fp.sw, 2) + ' (멈춤에서 ' + f(J.PIN_F_STOP + 0.05, 2) + ', 마스크 두께 포함)</p>';
    }
    case 'wire': {
      const sel = (key, label) => '<label class="field">' + label + '<select data-jack="' + key + '"><option value="">— 비움 —</option>' +
        Object.entries((jigMode === 'bl' ? LEADS_BL : LEADS)[track]).map(([v, t]) => '<option value="' + v + '"' + (st.jacks[key] === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>';
      const jacks = '<p class="label">키슬리 2400 앞면 (빨강 HI·SENSE HI, 검정 LO·SENSE LO)</p><div class="grid2">' + JACKS.map(([k, l]) => sel(k, l)).join('') + '</div>';
      return si
        ? '<h2>' + N + '선 연결</h2><p>지그 DB15 → 스위치 박스. 지그에는 스위치가 없고, 박스의 4단 2극 로터리가 화소의 F·S를 같이 고릅니다. 박스 출력 4개를 키슬리에 꽂습니다(ITO = +, 화소 Ag = −).</p><div class="opts">' +
          '<button class="opt" data-toggle="db15" aria-pressed="' + st.db15 + '">' + (st.db15 ? 'DB15 꽂음 (잭나사 조임)' : 'DB15 꽂기') + '</button></div><p class="label">로터리 (화소)</p><div class="opts">' +
          [0, 1, 2, 3, 4].map((p) => '<button class="opt" data-rot="' + p + '" aria-pressed="' + (st.rotary === p) + '">' + (p ? 'P' + p : 'OFF') + '</button>').join('') + '</div>' + jacks
        : '<h2>' + N + (t3 ? 'T–B 선 연결 (SMA–BNC ×4, 2T와 같음)' : '선 연결 (SMA–BNC ×4)') + '</h2><p>윗판 SMA F+·S+, 아랫판 SMA F−·S−를 SMA–BNC 케이블과 BNC–바나나로 키슬리에 꽂습니다. F+→HI, S+→SENSE HI, F−→LO, S−→SENSE LO.' +
          (t3 ? ' <b>M-F·M-S(−y 변)는 여기 꽂지 않습니다</b> — 다음 단계에서 전압계로.' : '') + '</p>' + jacks;
    }
    case 'mid': {
      const m = st.mid;
      return '<h2>' + N + '3T: M-F·M-S 연결 (윗판 −y 변 SMA)</h2><p>T–B는 2T 그대로입니다. M은 재결합 ITO(25 nm)에 댄 <b>전압 프로브</b>: T–M = V<sub>PVK</sub>를 전류 0의 고임피던스로 읽습니다(SMU 전압 읽기 모드 또는 DMM). ITO 면저항·접촉 저항은 전류가 없으니 값에 들어오지 않습니다.</p>' +
        '<p class="label">창 (장착 전에 닦음)</p><div class="opts">' + opt('mid.window', 'ok', '키 대각 반대 (−x,−y)에 창 4.4 mm') + opt('mid.window', 'key', '키 모서리 (+x,+y)를 닦음') + '</div>' +
        '<p class="label">mid 핀 아래</p><div class="opts">' + opt('mid.pad', 'ag', 'Ag mid 패드 Ø1.6') + opt('mid.pad', 'paste', 'Ag 페이스트 점') + opt('mid.pad', 'bare', '맨 ITO') + '</div>' +
        '<p class="label">M-F·M-S를 어디에</p><div class="opts">' + opt('mid.mode', 'probe', 'T–M 전압 읽기: 2번 SMU/DMM, 고임피던스 (I ≈ 0)') + opt('mid.mode', 'si', 'M–B Si Jsc: 소면적 조명 (2 × 2 mm)만') + opt('mid.mode', 'drive', 'M–B 전면적 Jsc (SMU 전류 구동)') + '</div>' +
        '<label class="check"><input type="checkbox" data-midchk' + (m.chain ? ' checked' : '') + '> 멀티미터 사슬 점검: M-F ↔ M-S 수십 Ω (ITO) · M ↔ F+ (위 패드) 단락 아님 · M ↔ F− (아래) 열림 (다이오드 값만)</label>' +
        '<p class="note">규칙: <b>M에는 전면적으로 전류를 흘리지 않는다.</b> 1 cm² 가운데에서 모서리 패드까지 ITO 약 70–290 Ω(가정) → 20 mA면 가로 전압강하 1.4–5.8 V.</p>';
    }
    case 'pc': {
      const p = st.pc, inp = (k, l, step) => '<label class="field">' + l + '<input type="number" inputmode="decimal" step="' + step + '" data-pc="' + k + '" value="' + esc(p[k]) + '"></label>';
      return '<h2>' + N + 'PC: 연결과 스윕 설정</h2><p>값은 지난 사람이 쓴 그대로입니다. 이 시료에 맞게 고칩니다: 끝 전압은 Voc보다 조금 위, compliance는 단락 전류보다 넉넉히, 면적은 <b>마스크 구멍</b> 면적.</p>' +
        '<div class="opts"><button class="opt" data-connect aria-pressed="' + p.connected + '">' + (p.connected ? '연결됨: KEITHLEY 2400 (GPIB 24)' : 'GPIB 연결') + '</button></div>' +
        '<label class="check"><input type="checkbox" data-pcchk="fourWire"' + (p.fourWire ? ' checked' : '') + '> 4선 (원격 감지, SENSE 단자)</label>' +
        '<div class="grid2">' + inp('vStart', '시작 V', '0.01') + inp('vStop', '끝 V', '0.01') + inp('step', '간격 V', '0.005') + inp('delay', '지연 ms', '10') +
        '<label class="field">스캔 방향<select data-pcsel="dir">' + [['both', '역 → 순 (둘 다)'], ['rev', '역방향만'], ['fwd', '순방향만']].map(([v, t]) => '<option value="' + v + '"' + (p.dir === v ? ' selected' : '') + '>' + t + '</option>').join('') + '</select></label>' +
        inp('comp', 'compliance mA', '1') + inp('area', '면적 cm²', '0.0001') + '</div><p class="note">' + (si ? '싱글: 마스크 구멍 2.5 × 2.5 mm' : '탠덤: KIER 마스크 창 1 × 1 cm') + '. 단락 전류는 Jsc × 면적.</p>';
    }
    case 'light': {
      const L = st.light;
      return '<h2>' + N + '빛과 기준 셀</h2><p>램프를 켜고 셔터를 엽니다. 기준 셀로 1 sun을 확인하고, 다르면 램프 출력을 고쳐 다시 잽니다. 지그의 포토다이오드는 상대 변화만 기록합니다(절대 조도계 아님).</p><div class="opts">' +
        '<button class="opt" data-toggle="light.lamp" aria-pressed="' + L.lamp + '">' + (L.lamp ? '램프 켜짐' : '램프 켜기') + '</button>' +
        '<button class="opt" data-toggle="light.shutter" aria-pressed="' + L.shutter + '">' + (L.shutter ? '셔터 열림' : '셔터 열기') + '</button></div>' +
        '<label class="field">램프 출력 <input type="range" min="0.85" max="1.10" step="0.01" data-level value="' + L.level + '"></label>' +
        '<div class="opts"><button class="btn ghost" data-ref>기준 셀 재기</button></div><p class="mono" id="refout">' + refText() + '</p>';
    }
    case 'run': return '<h2>' + N + 'J–V 재기</h2><p>역방향(Voc → Jsc) 다음 순방향으로 쓸고 Voc·Jsc·FF·PCE를 뽑습니다. 아래에 무엇 때문에 그런 곡선이 나왔는지 나옵니다.' + (t3 ? ' 3T는 같은 스윕에서 T–M(V<sub>PVK</sub>) 읽기도 같이 나옵니다.' : '') + '</p><div class="opts"><button class="btn" data-run>J–V 재기</button></div>';
  }
}
function refText() {
  const L = st.light;
  if (L.refRead == null) return '기준 셀: 아직 안 잼';
  if (L.refRead === 0) return '기준 셀: 0 mA (램프가 꺼졌거나 셔터가 닫힘)';
  return '기준 셀 Isc 비 = ' + f(L.refRead, 2) + ' sun' + (Math.abs(L.refRead - 1) <= 0.01 ? ' ✓ 1 sun' : ' → 램프 출력을 고치고 다시 재기');
}

function renderNav() {
  $('steps').innerHTML = STEPS[track].map(([id, t], i) => '<button data-step="' + i + '" class="' + (done(id, st) ? 'done' : '') + '"' + (i === cur ? ' aria-current="step"' : '') + '><b>' + (i + 1) + '</b>' + t + '</button>').join('');
  $('prev').disabled = cur === 0; $('next').disabled = cur === STEPS[track].length - 1;
}
function render() { $('card').innerHTML = cardHTML(STEPS[track][cur][0]); renderNav(); }
function go(i) { cur = Math.max(0, Math.min(STEPS[track].length - 1, i)); render(); view(VIEW[STEPS[track][cur][0]]); }
function changed() { if (st.light.refRead != null && !(st.light.lamp && st.light.shutter)) st.light.refRead = null; update3D(); renderNav(); }

// ---- events
document.addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (/^tr-(single|tandem|tandem3t)$/.test(b.id)) return setTrack(b.id.slice(3));
  if (/^jg-(prod|bl)$/.test(b.id)) return setJig(b.id.slice(3));
  if (b.dataset.blmount) { const c = J.correctState(track, true);
    for (const k of ['station', 'mask', 'ring', 'lid', 'knobs']) st[k] = JSON.parse(JSON.stringify(c[k]));
    st.cell = b.dataset.blmount === 'ok' ? c.cell : (track === 'single' ? 'up' : 'flip'); st.blm = b.dataset.blmount; render(); changed(); return; }
  if (b.dataset.step != null) return go(+b.dataset.step);
  if (b.id === 'prev') return go(cur - 1);
  if (b.id === 'next') return go(cur + 1);
  if (b.id === 'fill') { S[track] = st = J.correctState(track, jigMode === 'bl'); render(); changed(); return toast('모든 단계를 바르게 채웠습니다. 8단계에서 재 보세요.'); }
  if (b.dataset.set) { set(b.dataset.set, b.dataset.v); render(); changed(); return; }
  if (b.dataset.toggle) { set(b.dataset.toggle, !get(b.dataset.toggle)); render(); changed(); return; }
  if (b.dataset.rot != null) { st.rotary = +b.dataset.rot; render(); changed(); return; }
  if (b.dataset.knob != null) return turn(+b.dataset.knob, +b.dataset.d);
  if (b.hasAttribute('data-connect')) { st.pc.connected = !st.pc.connected; render(); changed(); if (st.pc.connected) toast('*IDN? → KEITHLEY INSTRUMENTS INC.,MODEL 2400'); return; }
  if (b.hasAttribute('data-ref')) { const L = st.light; L.refRead = L.lamp && L.shutter ? Math.round(L.level * 100) / 100 : 0; $('refout').textContent = refText(); renderNav(); return; }
  if (b.hasAttribute('data-run')) return runJV();
});
document.addEventListener('change', (e) => {
  const t = e.target;
  if (t.dataset.jack) { st.jacks[t.dataset.jack] = t.value; changed(); if (/^M-/.test(t.value)) toast('M 선을 2400 루프에? 셀 전류가 ITO를 지난다 — M은 전압 읽기 전용.'); }
  else if (t.hasAttribute('data-midchk')) { st.mid.chain = t.checked; changed(); }
  else if (t.dataset.pcchk) { st.pc[t.dataset.pcchk] = t.checked; changed(); }
  else if (t.dataset.pcsel) { st.pc[t.dataset.pcsel] = t.value; changed(); }
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.pc) { st.pc[t.dataset.pc] = t.dataset.pc === 'area' ? t.value : (t.value === '' ? '' : parseFloat(t.value)); renderNav(); }
  else if (t.hasAttribute('data-level')) { st.light.level = parseFloat(t.value); st.light.refRead = null; $('refout').textContent = refText(); changed(); }
});
function turn(k, d) {
  const t = Math.round((st.knobs[k] + d) * 10) / 10;
  if (t > 1.8) { toast('노브 ' + (k + 1) + ': 멈춤에 닿아 더 안 돕니다.'); st.knobs[k] = 1.8; }
  else st.knobs[k] = Math.max(-1.5, t);
  if (STEPS[track][cur][0] === 'knob') render(); changed();
}
function setJig(m) {   // 제작 지그 | 빔라인 셀 v3: separate states and results per jig
  jigMode = m; S = Sall[m]; last = Lall[m]; STEPS = m === 'bl' ? STEPS_BL : STEPS_PROD;
  for (const k of ['prod', 'bl']) $('jg-' + k).setAttribute('aria-pressed', String(m === k));
  $('jgnote').hidden = m !== 'bl';
  setTrack(track);
}
function setTrack(t) {
  track = t; st = S[t]; cur = 0;
  for (const k of Object.keys(GLB)) $('tr-' + k).setAttribute('aria-pressed', String(t === k));
  build3D(); render(); showResult(); view('jig', true);
}
let toastT = 0;
function toast(m) { const el = $('toast'); el.textContent = m; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 2600); }

// ---- run + chart
function runJV() {
  const res = J.simulate(st);
  if (!res.ok) { last[track] = { err: res.err }; showResult(); toast(res.err); return; }
  last[track] = { res, msgs: J.diagnose(st, res), state: JSON.parse(JSON.stringify(st)) };
  showResult(); renderNav(); flash();
  if (matchMedia('(max-width: 760px)').matches) $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function showResult() {
  const L = last[track], box = $('result');
  if (!L) { box.hidden = true; return; }
  box.hidden = false;
  if (L.err) { $('chart').innerHTML = ''; $('tbl').innerHTML = ''; $('vmid').hidden = true; $('msgs').className = 'msgs bad'; $('msgs').innerHTML = '<li>' + esc(L.err) + '</li>'; return; }
  const res = L.res, ref = J.simulate(J.correctState(track, jigMode === 'bl')).scans[0], T = J.TRACKS[track].target;
  $('chart').innerHTML = chart(res.scans, ref, L.state.pc);
  const row = (name, x) => '<tr><td>' + name + '</td><td>' + f(x.Voc, 3) + '</td><td>' + f(x.Jsc, 2) + '</td><td>' + (x.FF == null ? '–' : f(x.FF * 100, 1)) + '</td><td>' + f(x.PCE, 2) + '</td></tr>';
  $('tbl').innerHTML = '<tr><th></th><th>Voc (V)</th><th>Jsc (mA/cm²)</th><th>FF (%)</th><th>PCE (%)</th></tr>' +
    res.scans.map((s) => row(s.dir === 'rev' ? '역방향' : '순방향', s.fig)).join('') + row('예시 기준', ref.fig);
  const M = res.mid, vm = $('vmid');
  if (M && L.state.mid.mode) {
    const r = (x) => (x.Vread == null ? '–' : f(x.Vread, 2));
    vm.hidden = false;
    vm.textContent = 'T–M 읽기 (역방향, ' + (L.state.mid.mode === 'probe' ? 'I ≈ 0' : L.state.mid.mode === 'drive' ? 'M에 전류 — 가로 강하 포함' : '소면적 모드') + '): Voc점 ' + r(M.atVoc) + ' V · MPP ' + r(M.atMpp) + ' V · Jsc점 ' + r(M.atJsc) + ' V' +
      ' · V_Si = V − V_PVK: Voc점 ' + f(M.atVoc.Vsi, 2) + ' V · MPP ' + f(M.atMpp.Vsi, 2) + ' V (예시: 서브셀 다이오드 가정)';
  } else vm.hidden = true;
  const good = L.msgs.length >= 1 && /제대로/.test(L.msgs[0]);
  $('msgs').className = 'msgs ' + (good ? 'ok' : 'bad'); $('msgs').innerHTML = L.msgs.map((m) => '<li>' + esc(m) + '</li>').join('');
}
function chart(scans, ref, pc) {
  const W = 340, H = 230, m = { l: 40, r: 10, t: 10, b: 30 };
  const all = scans.flatMap((s) => s.pts).concat(ref.pts);
  let x0 = Math.min(pc.vStart, ...ref.pts.map((p) => p.v)), x1 = Math.max(pc.vStop, ...ref.pts.map((p) => p.v));
  let y0 = Math.min(-5, ...all.map((p) => p.j)), y1 = Math.max(25, ...all.map((p) => p.j));
  y0 = Math.max(y0, -400); y1 = Math.min(y1, 400);
  const X = (v) => m.l + (v - x0) / (x1 - x0) * (W - m.l - m.r), Y = (j) => m.t + (y1 - Math.max(y0, Math.min(y1, j))) / (y1 - y0) * (H - m.t - m.b);
  const nice = (a, b, n) => { const s = Math.pow(10, Math.floor(Math.log10((b - a) / n))), k = [1, 2, 5, 10].find((q) => (b - a) / (q * s) <= n) * s, o = []; for (let v = Math.ceil(a / k) * k; v <= b + 1e-9; v += k) o.push(+v.toFixed(6)); return o; };
  let g = '';
  for (const v of nice(x0, x1, 6)) g += '<line x1="' + X(v) + '" x2="' + X(v) + '" y1="' + m.t + '" y2="' + (H - m.b) + '" stroke="var(--line)"/><text x="' + X(v) + '" y="' + (H - m.b + 13) + '" text-anchor="middle">' + v + '</text>';
  for (const j of nice(y0, y1, 6)) g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(j) + '" y2="' + Y(j) + '" stroke="var(--line)"/><text x="' + (m.l - 4) + '" y="' + (Y(j) + 3) + '" text-anchor="end">' + j + '</text>';
  g += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + Y(0) + '" y2="' + Y(0) + '" stroke="var(--muted)" stroke-width="0.8"/>';
  const path = (pts) => 'M' + pts.map((p) => X(p.v).toFixed(1) + ',' + Y(p.j).toFixed(1)).join('L');
  g += '<path d="' + path(ref.pts) + '" fill="none" stroke="var(--ref)" stroke-width="1.4" stroke-dasharray="1.5 2.5"/>';
  for (const s of scans) g += '<path d="' + path(s.pts) + '" fill="none" stroke="' + (s.dir === 'rev' ? 'var(--accent)' : 'var(--make)') + '" stroke-width="2"' + (s.dir === 'fwd' ? ' stroke-dasharray="5 3"' : '') + '/>';
  g += '<text x="' + (W - m.r) + '" y="' + (H - 3) + '" text-anchor="end">V (V)</text><text x="4" y="' + (m.t + 8) + '">mA/cm²</text>';
  return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="J–V 곡선">' + g + '</svg>';
}

// ---- 3D -----------------------------------------------------------------------------------------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputEncoding = THREE.sRGBEncoding;
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, 1, 8000);
const controls = new THREE.OrbitControls(camera, canvas);
controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.49;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f88, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 0.85); sun.position.set(-160, 420, 260); scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(260, 120, -200); scene.add(fill);
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const bench = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1100), new THREE.MeshStandardMaterial({ color: 0xd4dad3, roughness: 0.95 }));
bench.rotation.x = -Math.PI / 2; bench.position.set(60, -12.7, -200); scene.add(bench);
const world = new THREE.Group(); world.rotation.x = -Math.PI / 2; scene.add(world);   // CAD z-up -> three y-up
const cad = (x, y, z) => new THREE.Vector3(x, z, -y);
function applyTheme() { const dark = css('--bg').toLowerCase() === '#101513'; scene.background = new THREE.Color(css('--stage')); bench.material.color.set(dark ? 0x1d2622 : 0xd4dad3); }

const mat = (c, o) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6, metalness: 0.05 }, o || {}));
const box = (w, d, h, c, x, y, z, o) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), mat(c, o)); m.position.set(x, y, z); return m; };
const cyl = (r, h, c, x, y, z, o) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), mat(c, o)); m.rotation.x = Math.PI / 2; m.position.set(x, y, z); return m; };
const BZ = -12.6;   // bench height (CAD z)

// bench props that both tracks share
const props = new THREE.Group(); world.add(props);
const K = { x: 230, y: 330, front: 145 };
props.add(box(213, 370, 89, 0x3a3f44, K.x, K.y, BZ + 44.5));
props.add(box(90, 2, 26, 0x18301f, K.x - 50, K.front - 1, BZ + 62, { emissive: 0x0d2a16 }));
const JACKPOS = { SHI: [K.x + 55, K.front - 2, BZ + 62], HI: [K.x + 80, K.front - 2, BZ + 62], SLO: [K.x + 55, K.front - 2, BZ + 30], LO: [K.x + 80, K.front - 2, BZ + 30] };
for (const [k, p] of Object.entries(JACKPOS)) { const j = cyl(4.5, 6, /LO/.test(k) ? 0x111111 : 0xc0262d, p[0], p[1], p[2]); props.add(j); }
const lamp = new THREE.Group(); props.add(lamp);
lamp.add(box(170, 170, 90, 0x50565c, 0, 0, 330));
const shutter = box(150, 150, 3, 0x2a2e33, 0, 0, 280); lamp.add(shutter);
const beam = new THREE.Mesh(new THREE.CylinderGeometry(70, 70, 270, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
beam.rotation.x = Math.PI / 2; beam.position.set(0, 0, 145); lamp.add(beam);
const pc = new THREE.Group(); props.add(pc);
pc.add(box(220, 12, 140, 0x2b2f33, -190, 260, BZ + 95)); pc.add(box(200, 2, 120, 0x1f4d36, -190, 253, BZ + 97, { emissive: 0x0b2416 })); pc.add(box(60, 40, 25, 0x2b2f33, -190, 265, BZ + 12));
const refcell = box(30, 30, 8, 0x1c2a4a, -90, -20, BZ + 4); props.add(refcell);
const swbox = new THREE.Group(); props.add(swbox);
swbox.add(box(110, 60, 45, 0x7d858c, 0, 120, BZ + 22.5));
const rotKnob = new THREE.Group(); rotKnob.position.set(0, 120, BZ + 45); swbox.add(rotKnob);
rotKnob.add(cyl(11, 10, 0x222222, 0, 0, 5)); rotKnob.add(box(3, 12, 2, 0xf2f2f2, 0, 5, 11));
const SWOUT = { 'F+': [-36, 150, BZ + 20], 'S+': [-12, 150, BZ + 20], 'F-': [12, 150, BZ + 20], 'S-': [36, 150, BZ + 20] };
for (const [k, p] of Object.entries(SWOUT)) swbox.add(cyl(4, 6, k[1] === '+' ? 0xc0262d : 0x111111, p[0], p[1] + 2, p[2]));
// 3T: a second meter (SMU in voltage mode / DMM) for the T–M probe, left of the Keithley; drawn only on the 3T track
const dmm = new THREE.Group(); props.add(dmm); dmm.visible = false;
const D = { x: -40, y: 330, front: 300 };
dmm.add(box(120, 60, 50, 0x4a4f55, D.x, D.y, BZ + 25)); dmm.add(box(70, 2, 18, 0x18301f, D.x - 15, D.front - 1, BZ + 34, { emissive: 0x0d2a16 }));
const DMMPOS = { 'M-F': [D.x + 30, D.front - 2, BZ + 16], 'M-S': [D.x + 48, D.front - 2, BZ + 16] };
for (const [k, p] of Object.entries(DMMPOS)) dmm.add(cyl(4, 6, k === 'M-F' ? 0xd08a1e : 0x111111, p[0], p[1], p[2]));
const cables = new THREE.Group(); world.add(cables);

// the jig of the current track
let jig = null; const anim = {}; const picks = [];
const glbCache = {};
function parseGLB(key, cb) {
  if (glbCache[key]) return cb(glbCache[key]);
  const b64 = (window.JIG_GLB || {})[key];
  if (!b64) { $('status').textContent = '모델 파일을 불러오지 못했습니다. 새로 고침해 보세요.'; return; }
  const buf = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
  new THREE.GLTFLoader().parse(buf, '', (g) => { glbCache[key] = g; cb(g); }, () => { $('status').textContent = '모델을 읽지 못했습니다.'; });
}
function parseModel(key, cb) {   // beamline v3 single / 3T = own parts + the shared 2T parts
  const base = WC_BASE[key];
  if (!base) return parseGLB(key, cb);
  if (glbCache['+' + key]) return cb(glbCache['+' + key]);
  parseGLB(key, (own) => parseGLB(base, (bg) => {
    const grp = new THREE.Group(), want = new Set(WC_SHARED[key]); grp.add(own.scene.clone(true));
    bg.scene.updateMatrixWorld(true); const inv = bg.scene.matrixWorld.clone().invert();
    bg.scene.traverse((o) => { if (!o.isMesh || !(want.has(o.name) || want.has(o.name.replace(/_\d+$/, '')))) return;
      const m = new THREE.Mesh(o.geometry, o.material); m.name = o.name; m.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); grp.add(m); });
    cb(glbCache['+' + key] = { scene: grp });
  }));
}
function build3D() {
  if (jig) { world.remove(jig.root); jig = null; }
  picks.length = 0;
  const key = (jigMode === 'bl' ? GLB_BL : GLB)[track];
  $('status').hidden = false;
  parseModel(key, (gltf) => {
    const src = gltf.scene.clone(true), root = new THREE.Group(); world.add(root);
    // beamline v3: CAD frame = cell upright, film side -y; measure it lying on its back under the lamp (wafer centre over the origin)
    const bl = jigMode === 'bl', ab = new THREE.Box3(), sb = new THREE.Box3(), db = new THREE.Box3();
    if (bl) src.traverse((o) => { if (!o.isMesh) return; const n = o.name.replace(/_/g, ' '); if (WC_HIDE.test(n)) return;
      o.geometry.computeBoundingBox(); ab.union(o.geometry.boundingBox); if (WC_SMP.test(n)) sb.union(o.geometry.boundingBox); if (/^DB15/.test(n)) db.union(o.geometry.boundingBox); });
    const WCC = bl ? sb.getCenter(new THREE.Vector3()) : null;
    const G = (name) => { const g = new THREE.Group(); g.name = name; root.add(g); return g; };
    const station = G('station'), body = G('body');
    const pivot = (x, y, z, parent) => { const g = new THREE.Group(); g.position.set(x, y, z); (parent || body).add(g); return g; };
    const sample = bl ? pivot(WCC.x, WCC.y, WCC.z) : pivot(0, 0, 3.73), maskG = pivot(0, 0, 0), ringG = pivot(0, 0, 0);
    const lid = pivot(-24.5, 0, 5.9), top = pivot(0, 0, 0);
    const knobs = [pivot(18, 18, 0, top), pivot(-18, -18, 0, top)];
    const meshes = []; src.traverse((o) => { if (o.isMesh) meshes.push(o); });
    root.add(src); world.updateMatrixWorld(true);
    for (const o of meshes) {
      const n = o.name.replace(/_/g, ' ');
      const ca = o.geometry.getAttribute('color'), base = new THREE.Color();
      const k = ca && ca.normalized && ca.array instanceof Uint8Array ? 1 / 255 : 1;
      if (ca) base.setRGB(ca.getX(0) * k, ca.getY(0) * k, ca.getZ(0) * k).convertSRGBToLinear(); else if (o.material && o.material.color) base.copy(o.material.color);
      o.material = new THREE.MeshStandardMaterial({ color: base, flatShading: true, roughness: /Mill-Max|SMA|DB15 female/.test(n) ? 0.35 : 0.7,
        metalness: /Mill-Max|SMA|screw|bolt|dowel|hinge pin|magnet|ball|rod|knob|nut/.test(n) ? 0.55 : 0.05,
        transparent: /sample: ITO glass|Si wafer|^단일 셀 유리|^CPI 필름/.test(n), opacity: /sample: ITO glass|^단일 셀 유리/.test(n) ? 0.55 : /^CPI 필름/.test(n) ? 0.3 : 1 });
      let g = body;
      if (bl) { if (WC_HIDE.test(n)) continue; if (WC_SMP.test(n)) g = sample; }   // Grace's plate + bracket stay at the beamline
      else if (/^station plate|^groove rod|station side/.test(n)) g = station;
      else if (/^sample|^KIER measurement mask|^Kapton tape|^3T mid window/.test(n)) g = sample;
      else if (/^aperture mask/.test(n)) g = maskG;
      else if (/^press ring/.test(n)) g = ringG;
      else if (/^hinged lid|^hinge pin|\(lid,/.test(n)) g = lid;
      else if (/^knob 1/.test(n)) g = knobs[0];
      else if (/^knob 2/.test(n)) g = knobs[1];
      else if (/^top PCB|^front pin|SMA edge jack [FS]\+|SMA edge jack M-[FS]/.test(n)) g = top;
      g.attach(o);
      if (/^knob|^hinged lid/.test(n)) { o.userData.pick = /^knob 1/.test(n) ? 'k0' : /^knob 2/.test(n) ? 'k1' : 'lid'; picks.push(o); }
    }
    root.remove(src);
    let db15W = null;
    if (bl) {   // lay it down: CAD (x, y, z) -> (x - cx, z - cz, BZ + ymax - y)
      root.rotation.x = -Math.PI / 2; root.position.set(-WCC.x, -WCC.z, BZ + ab.max.y);
      const d = db.getCenter(new THREE.Vector3()); db15W = [d.x - WCC.x, d.z - WCC.z, BZ + ab.max.y - d.y];
      jig_pair = null;
    }
    if (track !== 'single' && !bl) {   // KIER mask pair: the CAD masks when the GLB has them (production models), else drawn here: 25 mm steel, 1 x 1 cm window, holes at ±6.45
      const pair = new THREE.Group(); sample.add(pair);
      const glbMasks = sample.children.filter((o) => o.isMesh && /^KIER measurement mask|^Kapton tape/.test(o.name.replace(/_/g, ' ')));
      if (glbMasks.length) glbMasks.forEach((o) => pair.attach(o));
      else {
        const shp = new THREE.Shape(); shp.moveTo(-12.5, -12.5); shp.lineTo(12.5, -12.5); shp.lineTo(12.5, 12.5); shp.lineTo(-12.5, 12.5); shp.lineTo(-12.5, -12.5);
        const hole = (cx, cy, r) => { const h = new THREE.Path(); h.absarc(cx, cy, r, 0, Math.PI * 2, true); shp.holes.push(h); };
        const w = new THREE.Path(); w.moveTo(-5, -5); w.lineTo(-5, 5); w.lineTo(5, 5); w.lineTo(5, -5); w.lineTo(-5, -5); shp.holes.push(w);
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) hole(sx * 6.45, sy * 6.45, 1.15);
        const geo = new THREE.ExtrudeGeometry(shp, { depth: 0.12, bevelEnabled: false, curveSegments: 16 });
        const mm = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.7, roughness: 0.35 });
        const front = new THREE.Mesh(geo, mm); front.position.z = 0.14; const rear = new THREE.Mesh(geo, mm); rear.position.z = -0.27;
        pair.add(front); pair.add(rear);
      }
      jig_pair = pair;
    }
    jig = { root, station, body, sample, maskG, ringG, lid, top, knobs, bl, sc: WCC, db15W };
    $('status').hidden = true; applyTheme(); update3D(true);
  });
}
let jig_pair = null;

function cable(points, color, r) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
  const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, r, 8, false), mat(color, { roughness: 0.5 })); cables.add(m);
}
function update3D(instant) {
  if (!jig) return;
  const s = st, A = anim;
  A.bodyZ = s.station == null ? 45 : s.station === 'tilt' ? 2.5 : 0; A.bodyX = s.station == null ? -70 : 0; A.bodyTilt = s.station === 'tilt' ? 0.05 : 0;
  A.sampleZ = s.cell == null ? 40 : 0; A.sampleFlip = (s.cell === 'up' && track === 'single') || s.cell === 'flip' ? Math.PI : 0;
  jig.sample.visible = s.cell != null || (track !== 'single' && s.mask != null);
  if (track !== 'single') { A.sampleZ = s.cell == null ? (s.mask != null ? 30 : 40) : 0; if (jig_pair) { jig_pair.visible = s.mask !== 'none' && s.mask != null; jig_pair.rotation.z = s.mask === 'rot' ? 0.14 : 0; } }
  dmm.visible = track === 'tandem3t';
  jig.maskG.visible = track === 'single' && s.mask != null && s.mask !== 'none'; A.maskX = s.mask === 'shift' ? 1.5 : 0;
  jig.ringG.visible = track === 'single' && s.ring === 'in';
  A.lid = s.lid === 'closed' ? 0 : s.lid === 'half' ? -0.16 : -1.85;
  const c = s.knobs.map((t) => Math.min(0.9, 0.5 * t)), ex = 3;
  A.topZ = ex * (0.9 - (c[0] + c[1]) / 2); A.topTilt = Math.atan(ex * (c[0] - c[1]) / 50.9); A.k0 = -s.knobs[0] * 2 * Math.PI; A.k1 = -s.knobs[1] * 2 * Math.PI;
  rotKnob.rotation.z = -s.rotary * 0.6 + 1.2;
  swbox.visible = track === 'single';
  shutter.visible = !s.light.shutter; beam.visible = s.light.lamp && s.light.shutter;
  lamp.children[0].material.emissive = new THREE.Color(s.light.lamp ? 0x332a00 : 0x000000);
  // cables
  while (cables.children.length) { const m = cables.children.pop(); m.geometry.dispose(); }
  const dW = jig.db15W;   // beamline v3: every lead leaves through the DB15 on the cell
  if (track === 'single' && s.db15) cable(dW ? [dW, [dW[0], dW[1] + 18, dW[2] + 2], [0, 80, BZ + 10], [0, 90, BZ + 20]] : [[0, 43, 6], [0, 60, 8], [0, 80, 10], [0, 90, BZ + 20]], 0x8d959c, 3.2);
  if (s.pc.connected) cable([[-190, 286, BZ + 20], [-120, 400, BZ + 2], [100, 540, BZ + 2], [230, 516, BZ + 40]], 0x2d2d2d, 2.2);
  const SMA = { 'F+': [-10, 36, 8.3], 'S+': [0, 36, 8.3], 'F-': [-5, 36, -0.8], 'S-': [5, 36, -0.8], 'M-F': [-10, -36, 8.3], 'M-S': [10, -36, 8.3] };   // M-F / M-S on the TT3 -y edge
  const LOFF = { 'F+': -6, 'S+': -2, 'F-': 2, 'S-': 6, 'M-F': -10, 'M-S': 10 }, from = (lead) => (dW ? [dW[0] + LOFF[lead], dW[1] + 4, dW[2]] : SMA[lead]);
  const toJack = (st0, e, col, r) => { const dy = st0[1] < 0 ? -1 : 1, sOff = track === 'single' ? 12 : 20;
    cable([[st0[0], st0[1] + 2 * dy, st0[2]], [st0[0], st0[1] + sOff * dy, st0[2] + 3], [(st0[0] + e[0]) / 2, (st0[1] + e[1]) / 2 - 10, BZ + 3], [e[0], e[1] - 20, e[2] - 4], [e[0], e[1] - 3, e[2]]], col, r); };
  for (const [jk, lead] of Object.entries(s.jacks)) {
    if (!lead) continue;
    const st0 = track === 'single' ? SWOUT[lead] : from(lead), col = /^M-/.test(lead) ? 0xd08a1e : lead[1] === '+' ? 0xc0262d : 0x161616;
    toJack(st0, JACKPOS[jk], col, track === 'single' ? 1.4 : 1.9);
  }
  if (track === 'tandem3t' && s.mid.mode) for (const [lead, e] of Object.entries(DMMPOS)) toJack(from(lead), e, s.mid.mode === 'drive' ? 0xc0262d : 0xd08a1e, 1.9);   // M pair -> voltmeter (red = current forced through M: not allowed)
  if (instant) for (const k in A) curA[k] = A[k];
}
const curA = {};
function stepAnim() {
  if (!jig) return;
  for (const k in anim) { if (curA[k] == null) curA[k] = anim[k]; curA[k] += (anim[k] - curA[k]) * 0.16; if (Math.abs(anim[k] - curA[k]) < 1e-4) curA[k] = anim[k]; }
  const a = curA;
  if (jig.bl) { jig.body.position.set(a.bodyX, -a.bodyZ, 0); jig.sample.position.set(jig.sc.x, jig.sc.y - a.sampleZ, jig.sc.z); }   // cell frame: -y = up on the bench
  else { jig.body.position.set(a.bodyX, 0, a.bodyZ); jig.sample.position.z = 3.73 + a.sampleZ; }
  jig.body.rotation.x = a.bodyTilt; jig.sample.rotation.x = a.sampleFlip;
  jig.maskG.position.x = a.maskX; jig.lid.rotation.y = a.lid;
  jig.top.position.z = a.topZ; jig.top.setRotationFromAxisAngle(new THREE.Vector3(1, -1, 0).normalize(), a.topTilt);
  jig.knobs[0].rotation.z = a.k0; jig.knobs[1].rotation.z = a.k1;
}
let flashT = 0; function flash() { flashT = performance.now(); }

// camera views
const VIEWS = { jig: [cad(0, 0, 4), 190], bench: [cad(60, 170, 30), 900], keithley: [cad(250, 150, 30), 360], lamp: [cad(0, 40, 150), 820] };
let animId = 0;
function view(k, instant) {
  const [target, d0] = VIEWS[k], dist = d0 * Math.max(1, 1.25 / camera.aspect);
  const pos = target.clone().add(new THREE.Vector3(dist * 0.42, dist * 0.6, dist * 0.68));
  const id = ++animId;
  if (instant || matchMedia('(prefers-reduced-motion: reduce)').matches) { camera.position.copy(pos); controls.target.copy(target); return; }
  const p0 = camera.position.clone(), t0 = controls.target.clone(), t1 = performance.now();
  (function stp(now) { if (id !== animId) return; const q = Math.min(1, (now - t1) / 650), e = q * q * (3 - 2 * q);
    camera.position.lerpVectors(p0, pos, e); controls.target.lerpVectors(t0, target, e); if (q < 1) requestAnimationFrame(stp); })(t1);
}
// labels
const LABELS = [
  ['키슬리 2400', () => cad(K.x, K.front - 5, BZ + 100), () => true],
  ['HI', () => cad(...JACKPOS.HI).add(new THREE.Vector3(0, 9, 0)), () => true], ['LO', () => cad(...JACKPOS.LO).add(new THREE.Vector3(0, 9, 0)), () => true],
  ['S HI', () => cad(...JACKPOS.SHI).add(new THREE.Vector3(0, 9, 0)), () => true], ['S LO', () => cad(...JACKPOS.SLO).add(new THREE.Vector3(0, 9, 0)), () => true],
  ['스위치 박스', () => cad(0, 120, BZ + 70), () => track === 'single'],
  ['램프', () => cad(0, 0, 385), () => true], ['PC', () => cad(-190, 260, BZ + 175), () => true], ['기준 셀', () => cad(-90, -20, BZ + 18), () => true],
  ['노브 1', () => cad(18, 18, 22), () => track !== 'single' && jigMode !== 'bl'], ['노브 2', () => cad(-18, -18, 22), () => track !== 'single' && jigMode !== 'bl'],
  ['DB15 (빔라인 셀 v3)', () => cad(...((jig && jig.db15W) || [0, 0, 0])).add(new THREE.Vector3(0, 10, 0)), () => jigMode === 'bl'],
  ['전압계 (T–M = V_PVK, I ≈ 0)', () => cad(D.x, D.front - 5, BZ + 62), () => track === 'tandem3t'],
  ['M-F·M-S (−y)', () => cad(0, -40, 14), () => track === 'tandem3t' && jigMode !== 'bl'],
];
const labelEls = LABELS.map(([t]) => { const el = document.createElement('div'); el.className = 'tagl'; el.textContent = t; $('labels').appendChild(el); return el; });
// picking
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(); let down = null;
canvas.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
  const r = canvas.getBoundingClientRect(); ptr.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const targets = picks.concat(track === 'single' ? rotKnob.children : []);
  const hit = ray.intersectObjects(targets, false)[0]; if (!hit) return;
  const p = hit.object.userData.pick;
  if (p === 'k0' || p === 'k1') turn(+p[1], 0.5);
  else if (p === 'lid') { st.lid = st.lid === 'closed' ? 'open' : 'closed'; if (STEPS[track][cur][0] === 'lid') render(); changed(); toast(st.lid === 'closed' ? '딸깍: 걸쇠가 붙었습니다.' : '뚜껑을 열었습니다.'); }
  else { st.rotary = (st.rotary + 1) % 5; if (STEPS[track][cur][0] === 'wire') render(); changed(); toast('로터리: ' + (st.rotary ? 'P' + st.rotary : 'OFF')); }
});
function resize() { const r = canvas.parentElement.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(canvas.parentElement); resize();
function tick(now) {
  stepAnim(); controls.update();
  const fl = now - flashT < 900; refcell.material.emissive && refcell.material.emissive.setHex(0);
  renderer.render(scene, camera);
  const r = canvas.getBoundingClientRect();
  LABELS.forEach(([, pos, show], i) => { const el = labelEls[i]; if (!show() || !jig) { el.hidden = true; return; }
    const v = pos().applyMatrix4(world.matrixWorld).project(camera); el.hidden = v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05;
    el.style.left = ((v.x + 1) / 2 * r.width) + 'px'; el.style.top = ((1 - v.y) / 2 * r.height) + 'px'; });
  if (fl && beam.visible) beam.material.opacity = 0.18 + 0.12 * Math.sin((now - flashT) / 60); else beam.material.opacity = 0.18;
  requestAnimationFrame(tick);
}
// world.matrixWorld already maps CAD -> three; labels use CAD points through it
LABELS.forEach((l) => { const fn = l[1]; l[1] = () => { const v = fn(); return new THREE.Vector3(v.x, -v.z, v.y); }; });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

setTrack('single'); requestAnimationFrame(tick);
window.__measure = { renderer, scene, camera, view, get jig() { return jig; }, step: (n) => { for (let i = 0; i < (n || 1); i++) { stepAnim(); controls.update(); } renderer.render(scene, camera); } };
// self-test on load (console + one line at the bottom of the rail)
try { const t = J.selfTest(); $('selftest').textContent = '자체 점검: ' + t.pass + ' / ' + t.total + ' 통과 (바른 순서 = 예시 값, 실수마다 숫자가 맞는 방향으로)';
  console.info('[measure] self-test ' + t.pass + '/' + t.total); t.results.filter((x) => !x.ok).forEach((x) => console.warn('[measure] FAIL', x.name, x.info)); }
catch (err) { console.error('[measure] self-test error', err); }
})();
