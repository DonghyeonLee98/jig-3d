/* 지그 조립 연습 (assembly.html), 2026-10-23
 * 제작 싱글 = single_prod, 제작 탠덤 = tandem_prod in jig_models.js (CAD GLB, one mesh per part, mm, z up).
 * The step lists SINGLE_STEPS / TANDEM_STEPS are plain data: edit them to change the order or the words.
 *   step  = { id, phase, title, say, tip?, tool, focus, view, enter?, optional?, tasks: [...] }
 *   tasks = { t: 'kit',   rows: [{ label, qty, parts }] }                       tick the parts list
 *           { t: 'pick',  items, decoys?, target?, rule?, ordered?, after? }    pick from the tray (decoys answer with a hint)
 *           { t: 'probe', items: [{ label, part, ref?, read, needs? }] }       multimeter: tap the glowing part or its button
 *           { t: 'quiz',  q, opts: [{ t, ok?, hint? }] }
 *   item  = { label, parts | assy | act, from: 'top'|'bottom'|'+y'|'-y', layout: 'grid'|'unit', spin, mark, solder, targets }
 *   decoy = { label, like: [names to copy], flip: true, rotZ: deg, mark, hint }
 * Names are the GLB node names. 'name|bolt' / 'name|nut' = the two halves of a fused bolt + nut mesh,
 * '@dummy D' = the dummy board drawn here from the CAD numbers (dummy() in the build script),
 * 'tandem:' / 'single:' = a copy from the other jig. window.__asm.validate() lists names missing from the GLB. */
(function () {
  'use strict';
  const statusEl = document.getElementById('status');
  if (!window.THREE || !THREE.GLTFLoader || !THREE.OrbitControls || !window.JIG_GLB) {
    statusEl.textContent = '3D 파일을 불러오지 못했습니다. 새로 고침해 보세요.'; return;
  }
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  const BENCH_Z = -8.15;                       // bench top (CAD z): the finished jig stands on its three balls (-8.1)
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const $ = (id) => document.getElementById(id);

  // ============================================================ tools
  const TOOLS = [
    { id: 'iron', name: '인두', full: '인두', svg: '<path d="M3.5 20.5l2.8-2.8"/><path d="M6.3 17.7l3-3" stroke-width="2.6"/><path d="M10.2 13.8l5.6-5.6" stroke-width="4.4"/><path d="M16.6 7.4c1.4-1.5 2.6-2.2 4.2-2.3"/>' },
    { id: 'hex', name: '렌치 2.5', full: '육각 렌치 2.5 mm', svg: '<path d="M7.5 3.5v11.2a3.3 3.3 0 0 0 3.3 3.3h9.7" stroke-width="2.8"/>' },
    { id: 'tweezers', name: '핀셋', full: '핀셋', svg: '<path d="M8.6 3.2l2.3 17.3M15.4 3.2l-2.3 17.3M8.6 3.2h6.8"/>' },
    { id: 'epoxy', name: '에폭시', full: '2액 에폭시', svg: '<rect x="7.5" y="7" width="9" height="11.5" rx="1.6"/><path d="M12 7v11.5M10 3.5h4M12 3.5V7M12 18.5v2.5"/>' },
    { id: 'meter', name: '멀티미터', full: '멀티미터', svg: '<rect x="5" y="2.5" width="14" height="19" rx="2.2"/><rect x="8" y="5.5" width="8" height="4" rx=".8"/><circle cx="12" cy="15" r="3"/>' },
    { id: 'hand', name: '손', full: '손', svg: '<path d="M8 12.5V6a1.5 1.5 0 0 1 3 0v5.5M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 11.5V6.5a1.5 1.5 0 0 1 3 0V14c0 3.9-2.7 7-6.4 7-2.6 0-4.4-1.3-5.6-3.4L3.6 14a1.5 1.5 0 0 1 2.4-1.8L8 14.5"/>' },
  ];
  const TOOL = Object.fromEntries(TOOLS.map((t) => [t.id, t]));

  // ============================================================ part names (GLB node names)
  const PM = 'pin Mill-Max 0906-1 ';
  const S = {
    base: 'base plate, production (POM black 4.0: also under the DB15 tab, 3 balls glued half-deep, 2 magnets, nuts for the DB15 block)',
    balls: [1, 2, 3].map((i) => `kinematic ball ${i} (Tsubaki SBM-SUJ-5, SUJ2 d5, glued half-deep into the jig bottom)`),
    kmag: [1, 2].map((i) => `kinematic magnet ${i} (MISUMI HXNN6-2, jig side)`),
    pcb: 'bottom PCB S, production (FR4 1.6 ENIG black, 12 pins, 13 x 16 film-side window, DB15 tab 56 mm, TMP117 + SHT45 (I2C) + photodiode placed by JLC; KiCad pcb_kicad/S)',
    pin: { P1F: PM + 'P1F (-10.7,+2.0)', P1S: PM + 'P1S (-8.4,+3.5)', P2F: PM + 'P2F (-10.7,-2.0)', P2S: PM + 'P2S (-8.4,-3.5)',
      P3F: PM + 'P3F (+10.7,-2.0)', P3S: PM + 'P3S (+8.4,-3.5)', P4F: PM + 'P4F (+10.7,+2.0)', P4S: PM + 'P4S (+8.4,+3.5)',
      ITO_aF: PM + 'ITO_aF (-4.4,+10.0)', ITO_bF: PM + 'ITO_bF (+4.4,+10.0)', ITO_cS: PM + 'ITO_cS (-4.4,-10.0)', ITO_dS: PM + 'ITO_dS (+4.4,-10.0)' },
    db15: 'DB15 female right-angle NorComp 182-015-213R171 (8 pixel F/S + ITO F/S + I2C SDA/SCL/3V3 + PD)',
    block: 'DB15 block, production (POM black: flange behind a 1.45 mm front panel, 2 x 4-40 jackscrews Keystone 7229, 2 x SCB3-20 into nuts in the base)',
    jack: ['jackscrew 4-40 Keystone 7229 (left, panel -> DB15 flange)', 'jackscrew 4-40 Keystone 7229 (right, panel -> DB15 flange)'],
    bbolt: [1, 2].map((i) => `DB15 block bolt MISUMI SCB3-20 ${i} + nut SLBNR3 in the base|bolt`),
    bnut: [1, 2].map((i) => `DB15 block bolt MISUMI SCB3-20 ${i} + nut SLBNR3 in the base|nut`),
    tmp: 'temperature TI TMP117AIDRVR (±0.1 °C, I2C 0x49, unique ID; WSON-6 2x2) under the film',
    sht: 'humidity + temperature Sensirion SHT45-AD1F (±1 %RH, I2C 0x44, PTFE filter; DFN-4 1.5x1.5) on the tab',
    rc: '100 nF 0603 + 4.7 k SDA/SCL pull-ups 0603 (JLC basic parts)',
    pd: 'photodiode Vishay VBPW34S (light monitor, faces up)',
    dowel: [1, 2].map((i) => `dowel pin MISUMI MS2-6 ${i} (PCB -> frame)`),
    frame: 'frame v2 (POM: 0.8 mm edge ledge = hard stop, glass pocket, nut pockets, hinge knuckles, catch magnets)',
    mask: 'aperture mask (stainless 0.1 mm, laser-cut like an SMT stencil; 4 x 2.5 mm + a blank dark mask)',
    ring: 'press ring for 1.1T glass (1.1 mm: POM + 0.2 mm silicone; none for 2.2T)',
    lid: 'hinged lid, production (POM black 2.5, bevelled window 19 -> 23 mm, magnetic catch on +x)',
    hinge: 'hinge pin MISUMI MS2.5-30 (d2.5 x 30)',
    cmagF: [1, 2].map((i) => `catch magnet ${i} (frame, MISUMI HXNN6-2)`),
    cmagL: [1, 2].map((i) => `catch magnet ${i} (lid, MISUMI HXNN6-2)`),
    bolt: [1, 2, 3, 4].map((i) => `bolt MISUMI SCB3-8 ${i} (from below) + nut SLBNR3|bolt`),
    nut: [1, 2, 3, 4].map((i) => `bolt MISUMI SCB3-8 ${i} (from below) + nut SLBNR3|nut`),
    dummy: '@dummy D',
  };
  const SPIN = Object.values(S.pin);
  const PR = 'rear pin Mill-Max 0906-1 ', PF = 'front pin Mill-Max 0906-1 ';
  const xy = (pre) => ({ NE: pre + '(+6.45,+6.45)', NW: pre + '(-6.45,+6.45)', SW: pre + '(-6.45,-6.45)', SE: pre + '(+6.45,-6.45)' });
  const T = {
    base: 'base plate v4, production (POM black 4.0: 3 balls glued half-deep, 2 magnets, M3 nuts under the PCB for the knobs and screws, rear-photodiode window)',
    balls: [1, 2, 3].map((i) => `kinematic ball ${i} (Tsubaki SBM-SUJ-5, SUJ2 d5, glued half-deep into the jig bottom)`),
    kmag: [1, 2].map((i) => `kinematic magnet ${i} (MISUMI HXNN6-2, jig side)`),
    tb: 'bottom PCB TB, production (FR4 1.6 ENIG black, rear pins F-/S- at ±6.45, window d15, SMA F-/S-, TMP117 + SHT45 + front PD + FFC placed by JLC, rear PD by hand; KiCad pcb_kicad/TB)',
    rpin: xy(PR),
    frame: 'lower frame + corner posts (one part, POM, production: square pocket for the KIER mask pair + wafer, corner reliefs, sensor pocket, ledge, keyed pocket, vacuum ring, spring pockets)',
    fix: [1, 2].map((i) => `fixing screw MISUMI SCB3-10 ${i} (M3 x 10 A2-70)`),
    spring: [1, 2].map((i) => `lift spring MISUMI UL5-10 ${i} (OD5, free 10; lifts the top PCB)`),
    tt: 'top PCB TT, cross window, production (FR4 1.6 ENIG black, front pins F+/S+ at ±6.45 on tab discs, SMA F+/S+; KiCad pcb_kicad/TT)',
    fpin: xy(PF),
    knob: [1, 2].map((i) => `knob ${i}: MISUMI NOOSF3-14 (M3 x 14, d12 x 2.5)`),
    dowel: [1, 2].map((i) => `dowel pin MISUMI MS2-15 ${i} (guides the top PCB)`),
    smaFp: 'SMA edge jack F+ Samtec SMA-J-P-H-ST-EM1 (top PCB)', smaSp: 'SMA edge jack S+ Samtec SMA-J-P-H-ST-EM1 (top PCB)',
    smaFm: 'SMA edge jack F- Samtec SMA-J-P-H-ST-EM1 (bottom PCB)', smaSm: 'SMA edge jack S- Samtec SMA-J-P-H-ST-EM1 (bottom PCB)',
    nut: ['M3 nut SLBNR3 1 in the base under the PCB (knob)', 'M3 nut SLBNR3 2 in the base under the PCB (knob)',
      'M3 nut SLBNR3 3 in the base under the PCB (fixing screw)', 'M3 nut SLBNR3 4 in the base under the PCB (fixing screw)'],
    plug: 'rear plug (removable, Al black: dark rear + thermal path; d9.5 boss through the rear mask window; drops in from the top, four 0.6 mm ears rest on the bottom PCB along x / y)',
    pad: 'silicone thermal pad 0.5 mm on the plug boss (insulating, touches the wafer rear through the rear-mask window)',
    bead: 'NTC bead TDK B57861S0103F040 in the plug top (wafer-rear temperature; leads down the d1.2 hole)',
    tmp: 'temperature TI TMP117AIDRVR on the bottom PCB (±0.1 °C, I2C 0x49, unique ID; beside the rear window)',
    sht: 'humidity + temperature Sensirion SHT45-AD1F (±1 %RH, I2C 0x44, PTFE filter) on the tab',
    rc: '100 nF 0603 x2 + 4.7 k SDA/SCL pull-ups 0603 (JLC basic parts)',
    pdF: 'photodiode Vishay VBPW34S, front light (tab top, faces up)',
    pdR: 'photodiode Vishay VBPW34S, rear light (under the tab, faces down through the base window)',
    ffc: 'aux FFC connector Hirose FH12-8S-0.5SH(55) (I2C TMP117 + SHT45, plug NTC, photodiodes x2)',
  };

  // ============================================================ steps: 제작 싱글
  const TIGHT = { t: 'quiz', q: '얼마나 조이나?', opts: [
    { t: '머리가 닿은 뒤 살짝 더', ok: true },
    { t: '힘껏 끝까지', hint: 'POM은 눌려 들어간다. 너트 홈이 상하고 판이 휜다. 닿은 뒤 살짝만.' }] };
  const SINGLE_STEPS = [
    { id: 's-kit', phase: '준비', title: '부품 확인', focus: 'kit', view: 'top', tool: null,
      say: '싱글 지그 1대분이다. 줄을 누르면 그 부품이 3D에서 빛난다. 다 있으면 "모두 있음".',
      tasks: [{ t: 'kit', rows: [
        { label: '받침 S1 · 검정 POM 4 mm', qty: '1', parts: [S.base] },
        { label: '프레임 S2 · POM', qty: '1', parts: [S.frame] },
        { label: '힌지 뚜껑 S3 · POM 2.5 mm', qty: '1', parts: [S.lid] },
        { label: '아랫판 PCB S · FR4 1.6 ENIG', qty: '1', parts: [S.pcb] },
        { label: 'DB15 블록 S5 · POM', qty: '1', parts: [S.block] },
        { label: 'DB15 암 NorComp 182-015-213R171', qty: '1', parts: [S.db15] },
        { label: '스프링 핀 Mill-Max 0906-1', qty: '12', parts: SPIN },
        { label: 'PCB에 JLC가 단 것: TMP117 · SHT45 · PD · 100 nF · 4.7 k', qty: '달려 옴', parts: [S.tmp, S.sht, S.pd, S.rc] },
        { label: '강구 SBM-SUJ-5 (Ø5 SUJ2)', qty: '3', parts: S.balls },
        { label: '자석 HXNN6-2 (Ø6 × 2, N52)', qty: '6', parts: [...S.kmag, ...S.cmagF, ...S.cmagL] },
        { label: '맞춤핀 MS2-6 · 경첩 핀 MS2.5-30', qty: '2 · 1', parts: [...S.dowel, S.hinge] },
        { label: '볼트 SCB3-8 · SCB3-20', qty: '4 · 2', parts: [...S.bolt, ...S.bbolt] },
        { label: '너트 SLBNR3', qty: '6', parts: [...S.nut, ...S.bnut] },
        { label: '잭나사 4-40 Keystone 7229', qty: '2', parts: S.jack },
        { label: '누름 링 S4 · 마스크 0.1 mm', qty: '1 · 1', parts: [S.ring, S.mask] },
        { label: '더미 기판 D (마지막 점검)', qty: '1', parts: [S.dummy] },
        { label: '2액 에폭시 · 플럭스 · 솔더 윅 · 확대경', qty: '—', parts: [] }] }] },

    { id: 's-in', phase: 'PCB 납땜', title: '① 받은 PCB 보기 (JLC가 단 SMD)', focus: 'S', view: 'top', tool: null, enter: [['bench', 'S']],
      say: 'SMD는 JLC가 달아서 온다(ENIG, 조립 옵션 B). 확대경으로 하나씩 본다: 있는지, 핀 1 점이 실크 점과 맞는지, 다리 사이 브리지가 없는지.',
      tip: '손으로 다는 것은 핀 12개·DB15뿐이다. TMP117에 공장 고유 번호가 있어 ID 칩은 없다.',
      tasks: [{ t: 'inspect', items: [
        { label: 'U1 TMP117 (0, −10.6), 막 바로 밑', part: S.tmp, read: '있음 · 핀 1 맞음 · 브리지 없음' },
        { label: 'U2 SHT45 (−8, −27), 탭', part: S.sht, read: '있음 · 핀 1 맞음 · 필터 막 그대로' },
        { label: 'D1 포토다이오드 VBPW34S', part: S.pd, read: '있음 · 방향 맞음' },
        { label: 'C1·C2 100 nF · R1·R2 4.7 k', part: S.rc, read: '있음 · 브리지 없음' }] }] },

    { id: 's-pins', phase: 'PCB 납땜', title: '② 스프링 핀 12개, 플랜지 위', focus: 'S', view: 'iso', tool: 'iron',
      say: 'Mill-Max 0906-1을 윗면(플랜지 쪽)에서 끼우고 아랫면에서 납땜한다. 끝이 위로 서야 아래를 보는 막에 닿는다. 판에 수직으로.',
      tip: '프레임에 끼운 채 납땜하면 높이·수직이 맞는다.',
      tasks: [{ t: 'pick', items: [{ label: '핀 ×12 · 끝이 위', parts: SPIN, layout: 'grid', solder: 'bottom' }],
        decoys: [{ label: '핀 ×12 · 끝이 아래', like: SPIN, layout: 'grid', flip: true, hint: '거꾸로다. S판은 플랜지가 윗면이라 끝이 위로 선다.' }] }] },

    { id: 's-db15', phase: 'PCB 납땜', title: '③ DB15: 보드락 눌러 끼우고 납땜', focus: 'S', view: 'front', tool: 'iron',
      say: 'NorComp 182-015-213R171을 탭 끝에 맞춰(테두리 뒷면 = 탭 끝) 보드락을 눌러 끼우고, 아랫면에서 15핀과 보드락을 납땜한다.',
      tasks: [{ t: 'pick', items: [{ label: 'DB15 암 직각', parts: [S.db15] }],
        decoys: [{ label: 'DB15 블록 S5', like: [S.block], hint: 'POM 블록과 잭나사는 지그 조립 때, 납땜 뒤에 위에서 얹는다.' }] }] },

    { id: 's-dmm', phase: '점검', title: '멀티미터: DB15 ↔ 핀', focus: 'S', view: 'top', tool: 'meter',
      say: 'DB15 핀 ↔ 스프링 핀이 0.5 Ω 아래인지 본다. 빛나는 핀을 누르거나 버튼으로. 이웃 핀끼리, GND(14)와는 열려 있어야 한다. 그다음 I2C 선.',
      tip: 'DB15: 1–8 = P1F·P1S·P2F·P2S·P3F·P3S·P4F·P4S, 9 ITO F, 10 ITO S, 11 SDA, 12 PD, 13 SCL, 14 GND, 15 3V3 (차폐는 껍데기로만).',
      tasks: [{ t: 'probe', ref: S.db15, items: [
        { label: '1 ↔ P1F', part: S.pin.P1F, read: '< 0.5 Ω' }, { label: '2 ↔ P1S', part: S.pin.P1S, read: '< 0.5 Ω' },
        { label: '3 ↔ P2F', part: S.pin.P2F, read: '< 0.5 Ω' }, { label: '4 ↔ P2S', part: S.pin.P2S, read: '< 0.5 Ω' },
        { label: '5 ↔ P3F', part: S.pin.P3F, read: '< 0.5 Ω' }, { label: '6 ↔ P3S', part: S.pin.P3S, read: '< 0.5 Ω' },
        { label: '7 ↔ P4F', part: S.pin.P4F, read: '< 0.5 Ω' }, { label: '8 ↔ P4S', part: S.pin.P4S, read: '< 0.5 Ω' },
        { label: '9 ↔ ITO a', part: S.pin.ITO_aF, read: '< 0.5 Ω' }, { label: '9 ↔ ITO b', part: S.pin.ITO_bF, read: '< 0.5 Ω' },
        { label: '10 ↔ ITO c', part: S.pin.ITO_cS, read: '< 0.5 Ω' }, { label: '10 ↔ ITO d', part: S.pin.ITO_dS, read: '< 0.5 Ω' },
        { label: '1 ↔ 2 이웃', part: S.db15, read: '열림' }, { label: '1 ↔ 14 GND', part: S.db15, read: '열림' },
        { label: '15 ↔ 14 3V3–GND', part: S.tmp, read: '0 Ω 아님 (IC를 거친 큰 값은 괜찮음)' },
        { label: '11 ↔ 15 SDA–3V3', part: S.rc, read: '≈ 4.7 kΩ (풀업)' }, { label: '13 ↔ 15 SCL–3V3', part: S.rc, read: '≈ 4.7 kΩ (풀업)' },
        { label: '11 ↔ 13 SDA–SCL', part: S.sht, read: '단락 없음' }, { label: '12 PD, 빛 켜고', part: S.pd, read: '빛에 비례하는 전류' }] }] },

    { id: 's-balls', phase: '받침', title: '받침 아랫면: 강구 3개', focus: 'jig', view: 'below', tool: 'epoxy', enter: [['place', [S.base]]],
      say: '받침 S1을 뒤집어 강구 SBM-SUJ-5 3개를 자리(Ø5.05, 깊이 2.5)에 2액 에폭시로 붙인다. 반쯤 묻혀 2.5 mm 나오고, 책상에서 세 점으로 선다.',
      toolWhy: '강구는 2액 에폭시로 붙인다.',
      tasks: [{ t: 'pick', items: [{ label: '강구 ×3', parts: S.balls, from: 'bottom' }] }] },

    { id: 's-kmag', phase: '받침', title: '받침 아랫면: 자석 2개, 극성', focus: 'jig', view: 'below', tool: 'epoxy',
      say: 'HXNN6-2 2개를 자리(Ø6.2, 깊이 2.1)에 에폭시로 붙인다. 스테이션 판 자석에 대 보고 끌리는 면에 빨간 표시를 해 두고, 표시 면이 아래(스테이션 쪽)로 가게.',
      tasks: [{ t: 'pick', items: [{ label: '자석 ×2 · 표시 면 아래', parts: S.kmag, from: 'bottom', mark: -1 }],
        decoys: [{ label: '자석 ×2 · 표시 면 위', like: S.kmag, mark: 1, hint: '반대다. 스테이션 자석과 밀어내 지그가 뜨고 강구가 홈에서 벗어난다.' }] }] },

    { id: 's-bnut', phase: '받침', title: '받침 아랫면: DB15 블록 너트 2개', focus: 'jig', view: 'below', tool: 'tweezers',
      say: 'SLBNR3 2개를 받침 아랫면, 탭 양끝의 육각 홈에 넣는다. 나중에 DB15 블록 볼트 SCB3-20이 위에서 물린다.',
      toolWhy: '너트는 핀셋으로 육각 홈에 넣는다.',
      tasks: [{ t: 'pick', items: [{ label: '너트 SLBNR3 ×2', parts: S.bnut, from: 'bottom' }] }] },

    { id: 's-pcb', phase: '조립', title: 'PCB S를 받침 위에', focus: 'jig', view: 'iso', tool: 'hand',
      say: '납땜한 PCB를 받침에 얹는다. 핀 꼬리는 꼬리 홈에, DB15 꼬리·보드락은 탭 홈(38 × 9 × 2.5)에 들어가고 모서리 구멍 4개가 맞는다.',
      tasks: [{ t: 'pick', items: [{ label: 'PCB S (납땜 끝)', assy: 'S' }] }] },

    { id: 's-dowel', phase: '조립', title: '맞춤핀 MS2-6 2개', focus: 'jig', view: 'iso', tool: 'tweezers',
      say: 'Ø2 × 6 맞춤핀을 PCB 구멍 (−18.5, 0)·(18.5, 4)에 세운다. 프레임이 이 두 핀에 맞춰 앉는다.',
      tasks: [{ t: 'pick', items: [{ label: '맞춤핀 MS2-6 ×2', parts: S.dowel }],
        decoys: [{ label: '맞춤핀 MS2-15 ×2', like: ['tandem:' + T.dowel[0], 'tandem:' + T.dowel[1]], hint: 'MS2-15는 탠덤 윗판용(15 mm)이다. 싱글은 MS2-6.' }] }] },

    { id: 's-frame', phase: '조립', title: '프레임 S2', focus: 'jig', view: 'iso', tool: 'hand',
      say: '프레임을 맞춤핀에 맞춰 PCB 위에 얹는다. 경첩 마디가 −x(왼쪽), 자석 자리가 +x. 핀 12개는 가운데 구멍 안에 선다.',
      tasks: [{ t: 'pick', items: [{ label: '프레임 S2', parts: [S.frame] }],
        decoys: [{ label: '프레임 S2 (돌려 놓음)', like: [S.frame], rotZ: 180, hint: '돌아갔다. 맞춤핀 자리가 맞지 않고 경첩이 +x로 간다.' }] }] },

    { id: 's-nut', phase: '조립', title: '프레임 윗면: 모서리 너트 4개', focus: 'jig', view: 'top', tool: 'tweezers',
      say: 'SLBNR3 4개를 프레임 윗면 모서리 육각 홈에 넣는다. POM에는 나사산이 없어 볼트가 이 너트에 물린다(뚜껑 아래에 숨음).',
      tasks: [{ t: 'pick', items: [{ label: '너트 SLBNR3 ×4', parts: S.nut }] }] },

    { id: 's-bolt', phase: '조립', title: '볼트 SCB3-8 4개: 아래에서, 대각선', focus: 'jig', view: 'below', tool: 'hex',
      say: '받침 아래 카운터보어로 SCB3-8을 넣어 프레임 위 너트에 물린다. 볼트를 고른 뒤 빛나는 자리를 대각선 순서로 누른다.',
      toolWhy: 'SCB3 렌치볼트는 육각 렌치 2.5 mm로 조인다.',
      tasks: [
        { t: 'pick', target: true, rule: 'diagonal',
          items: [{ label: '볼트 SCB3-8 ×4', parts: S.bolt, from: 'bottom', spin: 3, targets: ['왼쪽 앞', '왼쪽 뒤', '오른쪽 앞', '오른쪽 뒤'] }],
          decoys: [
            { label: '볼트 SCB3-10 ×2', like: ['tandem:' + T.fix[0], 'tandem:' + T.fix[1]], hint: '10 mm면 끝이 프레임 위로 1.5 mm 나와 뚜껑에 닿는다. 모서리는 SCB3-8.' },
            { label: '볼트 SCB3-20 ×2', like: S.bbolt, hint: 'SCB3-20은 DB15 블록용(20 mm)이다.' }] },
        TIGHT] },

    { id: 's-cmag', phase: '뚜껑·DB15', title: '걸쇠 자석: 프레임 2 · 뚜껑 2, 극성', focus: 'jig', view: 'iso', tool: 'epoxy',
      say: 'HXNN6-2를 프레임 +x 자리 (18.5, ±10) 2개와 뚜껑 아랫면 자리 2개에 에폭시로 붙인다. 둘을 대 보고 끌리는 면에 표시: 프레임 자석은 표시 면이 위, 뚜껑 자석은 아래.',
      tasks: [{ t: 'pick', items: [
        { label: '프레임 자석 ×2 · 표시 면 위', parts: S.cmagF, mark: 1 },
        { label: '뚜껑 자석 ×2 · 표시 면 아래', parts: S.cmagL, mark: -1 }],
        decoys: [{ label: '프레임 자석 ×2 · 표시 면 아래', like: S.cmagF, mark: -1, hint: '반대다. 뚜껑 자석과 밀어내 뚜껑이 닫히지 않는다.' }] }] },

    { id: 's-lid', phase: '뚜껑·DB15', title: '뚜껑 S3 + 경첩 핀 MS2.5-30', focus: 'jig', view: 'iso', tool: 'hand',
      say: '뚜껑을 경첩 마디 사이에 맞추고 경첩 핀 Ø2.5 × 30을 y 방향으로 밀어 넣는다. 닫으면 +x 자석이 붙는다.',
      tasks: [
        { t: 'pick', items: [{ label: '힌지 뚜껑 S3', parts: [S.lid] }] },
        { t: 'pick', items: [{ label: '경첩 핀 MS2.5-30', parts: [S.hinge], from: '-y', dist: 34 }],
          decoys: [{ label: '맞춤핀 MS2-15', like: ['tandem:' + T.dowel[0]], hint: '경첩 구멍은 Ø2.6이라 Ø2 맞춤핀은 헐겁다. MS2.5-30.' }] }] },

    { id: 's-block', phase: '뚜껑·DB15', title: 'DB15 블록 S5 + 잭나사 2개', focus: 'jig', view: 'front', tool: 'hand',
      say: 'POM 블록을 납땜한 DB15 위에 얹고, 앞판 홈으로 4-40 잭나사(Keystone 7229) 2개를 DB15 테두리에 손으로 돌려 끼운다. 케이블을 꽂고 뺄 때 힘이 PCB 대신 블록·받침으로 간다.',
      tasks: [
        { t: 'pick', items: [{ label: 'DB15 블록 S5', parts: [S.block] }] },
        { t: 'pick', items: [{ label: '잭나사 4-40 ×2', parts: S.jack, from: '+y', spin: 3 }] }] },

    { id: 's-bbolt', phase: '뚜껑·DB15', title: 'DB15 블록 볼트 SCB3-20 2개', focus: 'jig', view: 'iso', tool: 'hex',
      say: 'SCB3-20 2개를 블록 위에서 넣어 받침 아랫면 너트에 물린다. 살짝만(POM).',
      tasks: [{ t: 'pick', items: [{ label: '볼트 SCB3-20 ×2', parts: S.bbolt, spin: 4 }],
        decoys: [{ label: '볼트 SCB3-8 ×2', like: [S.bolt[0], S.bolt[1]], hint: '8 mm는 짧다. 블록 14.5 + PCB 1.6 + 받침 4를 지나 너트까지 가려면 20 mm.' }] }] },

    { id: 's-dummy', phase: '마지막 점검', title: '① 더미 기판 D 넣고 닫기', focus: 'jig', view: 'iso', tool: 'hand', enter: [['lid', 'open']],
      say: '뚜껑을 열고 유리 대신 더미 D (FR4 1.0, 1 kΩ 0.1 % × 4)를 패드가 아래로 가게 포켓에 넣는다. 마스크·누름 링을 유리처럼 올리고 뚜껑을 닫는다.',
      tasks: [
        { t: 'pick', items: [{ label: '더미 D · 패드 아래', parts: [S.dummy] }],
          decoys: [{ label: '더미 D · 패드 위', like: [S.dummy], flip: true, hint: '패드와 저항이 아랫면이다. 핀에 닿게 뒤집는다.' }] },
        { t: 'pick', ordered: true, orderHint: '마스크가 먼저, 누름 링은 그 위다.',
          items: [{ label: '마스크 0.1 mm', parts: [S.mask] }, { label: '누름 링 S4', parts: [S.ring] }] },
        { t: 'pick', items: [{ label: '뚜껑 닫기', act: 'lidClose', parts: [S.lid] }] }] },

    { id: 's-dummy-dmm', phase: '마지막 점검', title: '② 화소마다 1 kΩ', focus: 'jig', view: 'iso', tool: 'meter',
      say: 'DB15에서 잰다. 화소 n의 F ↔ ITO F(9)는 1 kΩ + 접촉(2선). 키슬리 4선이면 1.000 kΩ ± 0.1 %, 2선과의 차이가 접촉 저항이다.',
      tasks: [{ t: 'probe', ref: S.db15, items: [
        { label: '1 ↔ 9 화소 1', part: S.db15, read: '≈ 1 kΩ + 접촉' }, { label: '3 ↔ 9 화소 2', part: S.db15, read: '≈ 1 kΩ + 접촉' },
        { label: '5 ↔ 9 화소 3', part: S.db15, read: '≈ 1 kΩ + 접촉' }, { label: '7 ↔ 9 화소 4', part: S.db15, read: '≈ 1 kΩ + 접촉' },
        { label: '1 ↔ 2 같은 화소 F–S', part: S.db15, read: '≈ 0 Ω' }, { label: '9 ↔ 10 ITO F–S', part: S.db15, read: '≈ 0 Ω' },
        { label: '1 ↔ 3 화소 1–2', part: S.db15, read: '≈ 2 kΩ (ITO를 거쳐)' },
        { label: 'I2C 스캔 (Pico, DB15 11·13)', part: S.db15, read: '0x49 TMP117 · 0x44 SHT45 찾음' }] }] },
  ];

  // ============================================================ steps: 제작 탠덤
  const TANDEM_STEPS = [
    { id: 't-kit', phase: '준비', title: '부품 확인', focus: 'kit', view: 'top', tool: null,
      say: '탠덤 지그 1대분이다(앞뒤 핀 4 + 4, SMA 4). 줄을 누르면 그 부품이 3D에서 빛난다.',
      tasks: [{ t: 'kit', rows: [
        { label: '받침 T1 · 검정 POM 4 mm', qty: '1', parts: [T.base] },
        { label: '아래 프레임 + 기둥 T2 · POM', qty: '1', parts: [T.frame] },
        { label: '아랫판 TB · 윗판 TT (십자 창)', qty: '1 · 1', parts: [T.tb, T.tt] },
        { label: '스프링 핀 Mill-Max 0906-1', qty: '8', parts: [...Object.values(T.rpin), ...Object.values(T.fpin)] },
        { label: 'SMA 엣지 잭 Samtec SMA-J-P-H-ST-EM1', qty: '4', parts: [T.smaFp, T.smaSp, T.smaFm, T.smaSm] },
        { label: 'TB에 JLC가 단 것: TMP117 · SHT45 · 앞빛 PD · FFC J3 · 100 nF · 4.7 k', qty: '달려 옴', parts: [T.tmp, T.sht, T.pdF, T.ffc, T.rc] },
        { label: '뒷빛 포토다이오드 VBPW34S (손 납땜)', qty: '1', parts: [T.pdR] },
        { label: '강구 SBM-SUJ-5 · 자석 HXNN6-2', qty: '3 · 2', parts: [...T.balls, ...T.kmag] },
        { label: '너트 SLBNR3', qty: '4', parts: T.nut },
        { label: '맞춤핀 MS2-15 · 고정 나사 SCB3-10', qty: '2 · 2', parts: [...T.dowel, ...T.fix] },
        { label: '스프링 UL5-10 · 노브 NOOSF3-14', qty: '2 · 2', parts: [...T.spring, ...T.knob] },
        { label: '(선택) 뒷면 플러그 T3 · 열패드 0.5 mm · NTC 비드 B57861S', qty: '1 · 1 · 1', parts: [T.plug, T.pad, T.bead] },
        { label: '2액 에폭시 · 플럭스 · 솔더 윅 · 확대경', qty: '—', parts: [] }] }] },

    { id: 't-tb-in', phase: 'TB 납땜', title: '① 받은 TB 보기 (JLC가 단 SMD)', focus: 'TB', view: 'top', tool: null, enter: [['bench', 'TB']],
      say: 'TB 윗면 SMD는 JLC가 달아서 온다. 확대경으로 본다: 있는지, 핀 1 점, 브리지. 특히 FFC J3 (0.5 mm 간격).',
      tasks: [
        { t: 'inspect', items: [
          { label: 'U1 TMP117 (11.5, 0), 뒷창 옆', part: T.tmp, read: '있음 · 핀 1 맞음 · 브리지 없음' },
          { label: 'U2 SHT45 (5.2, −23.6), 탭', part: T.sht, read: '있음 · 핀 1 맞음 · 필터 막 그대로' },
          { label: 'D1 앞빛 포토다이오드', part: T.pdF, read: '있음 · 방향 맞음' },
          { label: 'J3 FFC FH12 8핀', part: T.ffc, read: '있음 · 다리 사이 확인' },
          { label: 'C1·C2 100 nF · R5·R6 4.7 k', part: T.rc, read: '있음 · 브리지 없음' }] },
        { t: 'quiz', q: 'J3 다리(0.5 mm 간격) 사이에 땜납이 붙어 있다.', opts: [
          { t: '플럭스를 바르고 솔더 윅으로 걷어낸 뒤 확대경으로 본다', ok: true },
          { t: '땜납을 더 올려 녹인다', hint: '더 붙는다. 플럭스 + 솔더 윅으로 걷어낸다.' },
          { t: 'DC 측정이라 그냥 둔다', hint: '이웃 신호(SDA·SCL·3V3·PD·GND)가 붙어 센서를 못 읽는다.' }] }] },

    { id: 't-tb-d2', phase: 'TB 납땜', title: '② 뒷빛 PD D2만 손으로 (아랫면)', focus: 'TB', view: 'below', tool: 'iron',
      say: '아랫면 SMD는 D2 뒷빛 VBPW34S 하나라 손으로 납땜한다. 받침 창(5.3 × 6.4)으로 아래를 본다.',
      tasks: [{ t: 'pick', items: [{ label: 'D2 뒷빛 PD (아랫면)', parts: [T.pdR], from: 'bottom' }],
        decoys: [{ label: 'SMA 잭', like: [T.smaFm], hint: '큰 부품은 나중이다. 작은 D2부터.' }] }] },

    { id: 't-tb-pin', phase: 'TB 납땜', title: '③ 뒷면 핀 4개, 플랜지 위', focus: 'TB', view: 'iso', tool: 'iron',
      say: '0906-1 4개를 (±6.45, ±6.45)에 윗면(플랜지 쪽)에서 끼우고 아랫면에서 납땜한다. 끝이 위로 서서 웨이퍼 뒷면 패드를 누른다.',
      tasks: [{ t: 'pick', items: [{ label: '핀 ×4 · 끝이 위', parts: Object.values(T.rpin), layout: 'grid', solder: 'bottom' }],
        decoys: [{ label: '핀 ×4 · 끝이 아래', like: Object.values(T.rpin), layout: 'grid', flip: true, hint: '거꾸로다. TB는 플랜지가 윗면이라 끝이 위로.' }] }] },

    { id: 't-tb-sma', phase: 'TB 납땜', title: '④ SMA F−·S−', focus: 'TB', view: 'front', tool: 'iron',
      say: 'Samtec SMA-J-P-H-ST-EM1을 판 가장자리에 밀어 끼우고 가운데 핀 + 다리 4개(위·아래)를 납땜한다. F− x −5, S− x +5.',
      tasks: [{ t: 'pick', items: [{ label: 'SMA F− (x −5)', parts: [T.smaFm], from: '+y' }, { label: 'SMA S− (x +5)', parts: [T.smaSm], from: '+y' }] }] },

    { id: 't-tt-pin', phase: 'TT 납땜', title: '① 앞면 핀 4개, 플랜지 아래', focus: 'TT', view: 'front', tool: 'iron', enter: [['bench', 'TT']],
      say: '윗판 TT는 반대다. 핀을 아랫면(플랜지 쪽)에서 끼워 끝이 아래(웨이퍼 앞면)로 가게 하고, 납땜은 윗면에서.',
      tasks: [{ t: 'pick', items: [{ label: '핀 ×4 · 끝이 아래', parts: Object.values(T.fpin), layout: 'grid', from: 'bottom', solder: 'top' }],
        decoys: [{ label: '핀 ×4 · 끝이 위', like: Object.values(T.fpin), layout: 'grid', flip: true, hint: 'TT는 플랜지가 아랫면이다. 끝이 아래로 가야 웨이퍼 앞면에 닿는다.' }] }] },

    { id: 't-tt-sma', phase: 'TT 납땜', title: '② SMA F+·S+', focus: 'TT', view: 'front', tool: 'iron',
      say: 'F+ x −10, S+ x 0. 아랫판 SMA와 5 mm 엇갈려 플러그 너트 5/16"가 옆·위아래로 돈다.',
      tasks: [{ t: 'pick', items: [{ label: 'SMA F+ (x −10)', parts: [T.smaFp], from: '+y' }, { label: 'SMA S+ (x 0)', parts: [T.smaSp], from: '+y' }] }] },

    { id: 't-dmm', phase: '점검', title: '멀티미터: SMA ↔ 핀', focus: 'TT', view: 'iso', tool: 'meter',
      say: 'SMA 가운데 핀 ↔ 스프링 핀 < 0.5 Ω. F는 NE·SW, S는 NW·SE (위 F+·S+, 아래 F−·S−).',
      tasks: [
        { t: 'probe', focus: 'TT', view: 'iso', items: [
          { label: 'F+ ↔ NE', part: T.fpin.NE, ref: T.smaFp, read: '< 0.5 Ω' }, { label: 'F+ ↔ SW', part: T.fpin.SW, ref: T.smaFp, read: '< 0.5 Ω' },
          { label: 'S+ ↔ NW', part: T.fpin.NW, ref: T.smaSp, read: '< 0.5 Ω' }, { label: 'S+ ↔ SE', part: T.fpin.SE, ref: T.smaSp, read: '< 0.5 Ω' },
          { label: 'SMA 가운데 ↔ 다리', part: T.smaFp, ref: T.smaFp, read: '열림' }] },
        { t: 'probe', focus: 'TB', view: 'top', items: [
          { label: 'F− ↔ NE', part: T.rpin.NE, ref: T.smaFm, read: '< 0.5 Ω' }, { label: 'F− ↔ SW', part: T.rpin.SW, ref: T.smaFm, read: '< 0.5 Ω' },
          { label: 'S− ↔ NW', part: T.rpin.NW, ref: T.smaSm, read: '< 0.5 Ω' }, { label: 'S− ↔ SE', part: T.rpin.SE, ref: T.smaSm, read: '< 0.5 Ω' },
          { label: 'FFC 4 ↔ 1 3V3–GND', part: T.tmp, ref: T.ffc, read: '0 Ω 아님 (IC를 거친 큰 값은 괜찮음)' },
          { label: 'FFC 5 ↔ 4 SDA–3V3', part: T.rc, ref: T.ffc, read: '≈ 4.7 kΩ (풀업)' },
          { label: 'FFC 8 ↔ 4 SCL–3V3', part: T.rc, ref: T.ffc, read: '≈ 4.7 kΩ (풀업)' },
          { label: 'FFC 5 ↔ 8 SDA–SCL', part: T.sht, ref: T.ffc, read: '단락 없음' },
          { label: 'FFC 3·6 PD, 빛 켜고', part: T.pdF, ref: T.ffc, read: '빛에 비례하는 전류' }] }] },

    { id: 't-balls', phase: '받침', title: '받침 아랫면: 강구 3개', focus: 'jig', view: 'below', tool: 'epoxy', enter: [['place', [T.base]]],
      say: '받침 T1을 뒤집어 강구 SBM-SUJ-5 3개를 자리(Ø5.05, 깊이 2.5)에 2액 에폭시로 반쯤 붙인다. 2.5 mm 나와 스테이션 홈(MS3-10 두 개)에 45°로 닿는다.',
      toolWhy: '강구는 2액 에폭시로 붙인다.',
      tasks: [{ t: 'pick', items: [{ label: '강구 ×3', parts: T.balls, from: 'bottom' }] }] },

    { id: 't-kmag', phase: '받침', title: '받침 아랫면: 자석 2개, 극성', focus: 'jig', view: 'below', tool: 'epoxy',
      say: 'HXNN6-2 2개를 에폭시로. 스테이션 판 자석에 대 보고 끌리는 면에 빨간 표시를 해 두고, 표시 면이 아래(스테이션 쪽)로 가게.',
      tasks: [{ t: 'pick', items: [{ label: '자석 ×2 · 표시 면 아래', parts: T.kmag, from: 'bottom', mark: -1 }],
        decoys: [{ label: '자석 ×2 · 표시 면 위', like: T.kmag, mark: 1, hint: '반대다. 스테이션 자석과 밀어내 지그가 뜬다.' }] }] },

    { id: 't-nut', phase: '받침', title: '받침 윗면: M3 너트 4개', focus: 'jig', view: 'top', tool: 'tweezers',
      say: 'SLBNR3 4개를 받침 윗면 육각 홈(PCB 밑)에 넣는다: 노브 자리 (18, 18)·(−18, −18), 고정 나사 자리 2개. POM에는 나사산이 없어 노브·나사가 이 너트에 물린다.',
      toolWhy: '너트는 핀셋으로 육각 홈에 넣는다.',
      tasks: [{ t: 'pick', items: [{ label: '너트 SLBNR3 ×4', parts: T.nut }] }] },

    { id: 't-dowel', phase: '조립', title: '맞춤핀 MS2-15 2개', focus: 'jig', view: 'iso', tool: 'hand',
      say: 'Ø2 × 15를 받침 구멍 (19, 0)·(0, −19)에 끝까지 눌러 끼운다. TB·아래 프레임·윗판이 이 핀을 따라 내려간다.',
      tasks: [{ t: 'pick', items: [{ label: '맞춤핀 MS2-15 ×2', parts: T.dowel }],
        decoys: [{ label: '맞춤핀 MS2-6 ×2', like: ['single:' + S.dowel[0], 'single:' + S.dowel[1]], hint: 'MS2-6은 싱글용(6 mm)이다. 윗판까지 가려면 15 mm.' }] }] },

    { id: 't-tb', phase: '조립', title: 'TB를 맞춤핀에 끼워 받침 위에', focus: 'jig', view: 'iso', tool: 'hand',
      say: '납땜한 TB를 맞춤핀에 끼워 받침에 얹는다. 핀 꼬리·SMA 다리는 받침 홈에, 뒷빛 PD는 받침 창(5.3 × 6.4)에 들어간다.',
      tasks: [{ t: 'pick', items: [{ label: 'TB (납땜 끝)', assy: 'TB' }] }] },

    { id: 't-frame', phase: '조립', title: '아래 프레임 + 기둥 T2', focus: 'jig', view: 'iso', tool: 'hand',
      say: '맞춤핀에 끼워 TB 위에 얹는다. 스프링 홈이 있는 기둥이 노브 자리 (18, 18)·(−18, −18)이다.',
      tasks: [{ t: 'pick', items: [{ label: '아래 프레임 T2', parts: [T.frame] }],
        decoys: [{ label: '아래 프레임 T2 (90° 돌림)', like: [T.frame], rotZ: 90, hint: '돌아갔다. 맞춤핀 자리가 맞지 않는다.' }] }] },

    { id: 't-fix', phase: '조립', title: '고정 나사 SCB3-10 2개', focus: 'jig', view: 'iso', tool: 'hex',
      say: '기둥 위 카운터보어로 SCB3-10을 넣어 받침 너트에 물린다(받침 + TB + 아래 프레임을 묶음). 고른 뒤 빛나는 자리를 번갈아 조금씩.',
      toolWhy: 'SCB3 렌치볼트는 육각 렌치 2.5 mm로 조인다.',
      tasks: [
        { t: 'pick', target: true,
          items: [{ label: '고정 나사 SCB3-10 ×2', parts: T.fix, spin: 4, targets: ['왼쪽 뒤', '오른쪽 앞'] }],
          decoys: [
            { label: '볼트 SCB3-8 ×2', like: ['single:' + S.bolt[0], 'single:' + S.bolt[1]], hint: '8 mm면 너트에 0.95 mm만 물린다(10 mm는 2.95 mm).' },
            { label: '볼트 SCB3-20 ×2', like: ['single:' + S.bbolt[0], 'single:' + S.bbolt[1]], hint: '20 mm면 끝이 받침 아래로 약 9 mm 나와 스테이션에 닿는다.' }] },
        TIGHT] },

    { id: 't-plug', phase: '윗판·노브', title: '(선택) 뒷면 플러그 T3', focus: 'jig', view: 'top', tool: 'hand', optional: '양면 측정이면 안 씀',
      say: '어두운 뒷면·웨이퍼 뒷면 온도가 필요할 때. NTC 비드(TDK B57861S)를 윗면 자리에 넣고 리드선은 Ø1.2 구멍으로 내려 TB TP1·TP2에(극성 없음). 열패드 0.5 mm를 얹어 위에서 TB 창 Ø15로 넣는다.',
      tip: '윗판을 얹기 전에 넣는다(위에서 떨어뜨려 넣는 부품). 리드선 길이·길은 실물에서 정한다.',
      tasks: [{ t: 'pick', items: [{ label: '플러그 · 귀 x·y', parts: [T.plug, T.pad, T.bead], layout: 'unit' }],
        decoys: [{ label: '플러그 · 귀 대각선', like: [T.plug, T.pad, T.bead], layout: 'unit', rotZ: 45, hint: '귀가 대각선이면 핀(±6.45 대각선)에 닿는다. 귀는 x·y 방향.' }] }] },

    { id: 't-spring', phase: '윗판·노브', title: '스프링 UL5-10 2개', focus: 'jig', view: 'top', tool: 'hand',
      say: '노브 기둥의 스프링 홈 (18, 18)·(−18, −18)에 넣는다. 노브를 풀면 윗판을 3.5 mm 들어 올린다.',
      tasks: [{ t: 'pick', items: [{ label: '스프링 UL5-10 ×2', parts: T.spring }] }] },

    { id: 't-tt', phase: '윗판·노브', title: '윗판 TT 얹기', focus: 'jig', view: 'iso', tool: 'hand',
      say: '납땜한 TT를 핀이 아래로 가게 맞춤핀 MS2-15에 끼워 스프링 위에 얹는다. SMA는 TB와 같은 +y 쪽.',
      tasks: [{ t: 'pick', items: [{ label: 'TT (납땜 끝)', assy: 'TT' }] }] },

    { id: 't-knob', phase: '윗판·노브', title: '노브 NOOSF3-14 2개', focus: 'jig', view: 'iso', tool: 'hand',
      say: '윗판 구멍으로 받침 너트에 손으로 돌려 넣는다. 시료 없이 끝까지 조이지 않는다: 앞뒤 핀이 같은 자리라 끝끼리 닿는다(윗판이 기둥에서 1.3 mm 넘게 떠 있게, 계산).',
      tip: '시료가 있으면 핀이 닿고 1.8바퀴 더 돌리면 기둥에 닿아 멈춘다(하드 스톱). 6.2바퀴 풀면 빠진다.',
      tasks: [{ t: 'pick', items: [{ label: '노브 ×2', parts: T.knob, spin: 2 }],
        decoys: [{ label: '고정 나사 SCB3-10 ×2', like: T.fix, hint: '노브 자리에는 노브. 시료를 바꿀 때마다 공구 없이 연다.' }],
        after: [['lift', 2.5]] }] },

    { id: 't-final', phase: '마지막 점검', title: '조립 뒤 다시 재기', focus: 'jig', view: 'iso', tool: 'meter',
      say: '탠덤 더미 기판은 아직 없다. 조립한 채로 SMA ↔ 핀, 앞뒤 핀 단락, I2C 센서, 플러그 NTC를 다시 본다.',
      tasks: [{ t: 'probe', items: [
        { label: 'F+ ↔ NE 앞 핀', part: T.fpin.NE, ref: T.smaFp, read: '< 0.5 Ω' },
        { label: 'F− ↔ NE 뒤 핀', part: T.rpin.NE, ref: T.smaFm, read: '< 0.5 Ω' },
        { label: 'F+ ↔ F− (시료 없음)', part: T.smaFm, ref: T.smaFp, read: '열림 (앞뒤 핀이 안 닿음)' },
        { label: 'I2C 스캔 (Pico, FFC 5·8)', part: T.tmp, ref: T.ffc, read: '0x49 TMP117 · 0x44 SHT45 찾음' },
        { label: 'FFC 2 ↔ 1 플러그 NTC', part: T.bead, ref: T.ffc, read: '≈ 10 kΩ (25 °C)', needs: T.plug }] }] },
  ];

  const CHECK = {
    single: ['받은 PCB: JLC SMD 있음·핀 1 맞음·브리지 없음', '핀 12개가 수직, 아랫면 납땜에 브리지 없음 (확대경)', 'DB15 1–10 ↔ 핀 < 0.5 Ω, 이웃 핀·14 GND는 열림',
      '3V3(15) ↔ GND(14) 단락 없음, SDA(11)·SCL(13) ↔ 3V3 ≈ 4.7 kΩ, PD 12는 빛에 비례', 'Pico I2C 스캔: 0x49 TMP117 · 0x44 SHT45, TMP117 고유 번호를 이름표·기록에',
      '강구 3개가 2.5 mm 나와 책상에서 흔들리지 않음', '자석: 스테이션 판에 올리면 끌려 앉음',
      '볼트 SCB3-8 4개·SCB3-20 2개는 닿은 뒤 살짝 (POM 눌림 없음)', '뚜껑: 경첩이 부드럽고 +x 자석이 붙음',
      'DB15 블록: 케이블을 꽂고 뺄 때 PCB가 휘지 않음', '더미 D: 화소 4개 모두 ≈ 1 kΩ (키슬리 4선 1.000 kΩ ± 0.1 %)',
      '핀 마모 기록: 2선 값 − 1 kΩ를 날짜별로'],
    tandem: ['핀 8개 수직 (TB 끝 위, TT 끝 아래), 납땜 브리지 없음', '받은 TB: JLC SMD·FFC J3 0.5 mm 다리 브리지 없음, D2만 손 납땜',
      'SMA ↔ 핀 < 0.5 Ω: F+·F− → NE·SW, S+·S− → NW·SE, 가운데 ↔ 다리는 열림',
      'FFC 4(3V3) ↔ 1(GND) 단락 없음, 5·8 ↔ 4 ≈ 4.7 kΩ, 2 ↔ 1 플러그 NTC ≈ 10 kΩ, 3·6 PD는 빛에 비례', 'Pico I2C 스캔: 0x49 TMP117 · 0x44 SHT45 (FFC 5 SDA · 8 SCL)',
      '강구 3개 2.5 mm 돌출, 자석이 스테이션에 끌림', '고정 나사 SCB3-10 2개는 닿은 뒤 살짝 (POM)',
      '노브를 풀면 스프링이 윗판을 3.5 mm 올림, 6.2바퀴 풀면 빠짐', '시료 없이 노브를 끝까지 조이지 않음 (앞뒤 핀 끝이 맞닿음)',
      '시료를 넣으면 핀이 닿고 1.8바퀴 더 → 기둥에서 멈춤', '뒷면 플러그 (쓸 때): 귀 x·y, 열패드가 웨이퍼 뒷면에 닿음'],
  };
  const NOTES = {
    single: ['PCB S는 10/23 KiCad 판 기준, SMD는 JLC 조립 (아직 주문 전)', 'POM 부품(S1–S5)은 JLCCNC 견적 전, 치수는 CAD STEP',
      '강구·자석 접착은 2액 에폭시 (연구실 재고 확인), 방법은 실물로 확인', '자석 극성 표시는 연습용 표시 (짝 자석에 대 보고 정함)',
      '손 납땜 순서: 싱글 핀 → DB15, 탠덤 D2 → 핀 → SMA (SMD는 JLC)'],
    tandem: ['웨이퍼 두께 0.5 mm (사용자 사진, 자로 재면 0.3–0.35) — 마이크로미터 확인 전 · 25 mm는 KIER 마스크 크기', '핀 ±6.45는 KIER 마스크 사진 실측, 캘리퍼 확인 전',
      'PCB TT·TB는 10/23 KiCad 판 기준, TB SMD는 JLC 조립 (D2만 손, 아직 주문 전)', '탠덤 더미 기판은 아직 없음 (싱글 더미 D만 있음)',
      '플러그 NTC 리드선 길이·길은 실물에서 정함', '"끝까지 조이면 핀 끝끼리 닿음"은 CAD 계산 (핀 자유 높이 4.5 × 2 = 9.0 > 판 사이 7.7)'],
  };

  const TRACKS = {
    single: { key: 'single', glb: 'single_prod', title: '제작 싱글', steps: SINGLE_STEPS,
      assy: { S: { board: S.pcb, jlc: [S.tmp, S.sht, S.pd, S.rc], parts: [S.pcb, ...SPIN, S.db15, S.tmp, S.sht, S.pd, S.rc], at: [-92, 0, -3.55] } },
      lid: [S.lid, ...S.cmagL], knobs: [], springs: [] },
    tandem: { key: 'tandem', glb: 'tandem_prod', title: '제작 탠덤', steps: TANDEM_STEPS,
      assy: { TB: { board: T.tb, jlc: [T.tmp, T.sht, T.pdF, T.ffc, T.rc], parts: [T.tb, ...Object.values(T.rpin), T.smaFm, T.smaSm, T.tmp, T.sht, T.pdF, T.pdR, T.ffc, T.rc], at: [-88, 0, -3.2] },
        TT: { board: T.tt, parts: [T.tt, ...Object.values(T.fpin), T.smaFp, T.smaSp], at: [88, 0, -11.0], lift: 3.5 } },
      lid: [], knobs: T.knob, springs: T.spring },
  };
  // the 12 single pin positions (s2_pins) for the dummy pads
  const SC_PINS = [[-10.7, 2], [-8.4, 3.5], [-10.7, -2], [-8.4, -3.5], [10.7, 2], [8.4, 3.5], [10.7, -2], [8.4, -3.5], [-4.4, 10], [4.4, 10], [-4.4, -10], [4.4, -10]];
  const SPLIT = [{ re: /^bolt MISUMI SCB3-8 \d \(from below\) \+ nut SLBNR3$/, nut: (z) => z >= 3.39 },
    { re: /^DB15 block bolt MISUMI SCB3-20 \d \+ nut SLBNR3 in the base$/, nut: (z) => z <= -3.1 }];

  // ============================================================ scene (as index.html)
  const canvas = $('c');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputEncoding = THREE.sRGBEncoding;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.08; controls.minDistance = 20; controls.maxDistance = 1200;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a8f88, 0.85));
  const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(-120, 220, 160); scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.35); fill.position.set(160, 80, -120); scene.add(fill);
  const under = new THREE.DirectionalLight(0xffffff, 0.35); under.position.set(60, -220, 90); scene.add(under);
  const bench = new THREE.Mesh(new THREE.PlaneGeometry(380, 260), new THREE.MeshStandardMaterial({ color: 0xd4dad3, roughness: 0.95 }));
  bench.rotation.x = -Math.PI / 2; bench.position.set(0, BENCH_Z - 0.03, 30); scene.add(bench);
  const grid = new THREE.GridHelper(380, 38, 0x9aa49c, 0xb7bfb8); grid.position.set(0, BENCH_Z - 0.02, 30); grid.scale.z = 260 / 380; scene.add(grid);
  const cad = new THREE.Group(); cad.rotation.x = -Math.PI / 2; scene.add(cad);      // CAD z-up -> three y-up
  const fx = new THREE.Group(); cad.add(fx);                                         // per-task copies, ghosts, probes
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const MAT = {
    solder: new THREE.MeshStandardMaterial({ color: lin('#c9cdd2'), metalness: 0.8, roughness: 0.3 }),
    mark: new THREE.MeshStandardMaterial({ color: lin('#d0352b'), roughness: 0.5 }),
    holder: new THREE.MeshStandardMaterial({ color: lin('#8d958f'), roughness: 0.85, flatShading: true }),
    red: new THREE.MeshStandardMaterial({ color: lin('#c62828'), roughness: 0.5 }),
    black: new THREE.MeshStandardMaterial({ color: lin('#222222'), roughness: 0.5 }),
    tip: new THREE.MeshStandardMaterial({ color: lin('#d8d8d8'), metalness: 0.8, roughness: 0.3 }),
  };
  const MARK_GEO = new THREE.CylinderGeometry(1.5, 1.5, 0.06, 20); MARK_GEO.rotateX(Math.PI / 2);
  const ghostMat = () => new THREE.MeshBasicMaterial({ color: lin(css('--accent') || '#1f6b45'), transparent: true, opacity: 0.3, depthWrite: false });

  function applyTheme() {
    const dark = css('--bg').toLowerCase() === '#101513';
    scene.background = new THREE.Color(css('--stage') || '#e9ede8');
    bench.material.color.set(dark ? 0x1d2622 : 0xd4dad3);
    grid.material.color.set(dark ? 0x33403a : 0xb2bab3);
  }

  // ============================================================ parts
  const san = (s) => s.replace(/\s/g, '_').replace(/[\[\]\.:\/]/g, '');     // GLTFLoader node-name sanitising (as index.html)
  const METAL = /Mill-Max|SMA|screw|bolt|dowel|hinge pin|magnet|nut|ball|jackscrew|spring|mask/;
  function addPart(tr, name, obj, c, box) {
    obj.visible = false; obj.position.copy(c);
    const p = { name, obj, c, box, size: box.getSize(new V3()), placed: false };
    obj.userData.part = p; tr.group.add(obj); tr.parts[name] = p; return p;
  }
  function makePart(tr, name, geom, color) {
    geom.computeBoundingBox();
    const c = geom.boundingBox.getCenter(new V3());
    geom.translate(-c.x, -c.y, -c.z); geom.computeBoundingBox();
    const mat = new THREE.MeshStandardMaterial({ color, flatShading: true, roughness: /Mill-Max|SMA|DB15 female/.test(name) ? 0.35 : 0.7, metalness: METAL.test(name) ? 0.55 : 0.05 });
    return addPart(tr, name, new THREE.Mesh(geom, mat), c, geom.boundingBox.clone());
  }
  function subGeom(geom, keep) {                     // the triangles whose three z values pass keep(), compact
    const pos = geom.getAttribute('position'), idx = geom.index, n = idx ? idx.count : pos.count;
    const map = new Map(), P = [], I = [];
    for (let t = 0; t < n; t += 3) {
      const v = [0, 1, 2].map((k) => (idx ? idx.getX(t + k) : t + k));
      if (!keep(pos.getZ(v[0]), pos.getZ(v[1]), pos.getZ(v[2]))) continue;
      for (const a of v) { let m = map.get(a); if (m === undefined) { m = P.length / 3; map.set(a, m); P.push(pos.getX(a), pos.getY(a), pos.getZ(a)); } I.push(m); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); return g;
  }
  function buildDummy(tr) {                          // PCB D as dummy(): FR4 25 x 25 x 1.0 at the glass height, pads and resistors underneath
    const g = new THREE.Group(), z0 = 3.6, c = new V3(0, 0, 3.85);
    const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x - c.x, y - c.y, z - c.z); g.add(m); };
    add(new THREE.BoxGeometry(25, 25, 1.0), new THREE.MeshStandardMaterial({ color: new THREE.Color(33 / 255, 107 / 255, 51 / 255).convertSRGBToLinear(), flatShading: true, roughness: 0.7 }), 0, 0, z0 + 0.5);
    const pad = new THREE.CylinderGeometry(1.0, 1.0, 0.035, 18); pad.rotateX(Math.PI / 2);
    const gold = new THREE.MeshStandardMaterial({ color: lin('#d4ad36'), metalness: 0.6, roughness: 0.35 });
    for (const [x, y] of SC_PINS) add(pad, gold, x, y, z0 - 0.0175);
    const res = new THREE.BoxGeometry(1.6, 0.8, 0.5), blk = new THREE.MeshStandardMaterial({ color: lin('#202226'), roughness: 0.6 });
    for (const [x, y] of [[-4.6, 4.4], [-4.6, -4.4], [4.6, -4.4], [4.6, 4.4]]) add(res, blk, x, y, z0 - 0.25);
    return addPart(tr, S.dummy, g, c, new THREE.Box3(new V3(-12.5, -12.5, -0.75), new V3(12.5, 12.5, 0.75)));
  }
  function loadTrack(tr) {
    return new Promise((resolve, reject) => {
      const buf = Uint8Array.from(atob(window.JIG_GLB[tr.glb]), (ch) => ch.charCodeAt(0)).buffer;
      new THREE.GLTFLoader().parse(buf, '', (gltf) => {
        tr.group = new THREE.Group(); tr.group.visible = false; cad.add(tr.group); tr.parts = {};
        const raw = gltf.parser.json.nodes.map((n) => n.name); tr.raw = new Set(raw);
        const bySan = {}; raw.forEach((n) => { bySan[san(n)] = n; });
        const lookup = (s) => bySan[s] || bySan[s.replace(/_\d+$/, '')] || null;
        const meshes = []; gltf.scene.updateMatrixWorld(true);
        gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
        for (const o of meshes) {
          const name = lookup(o.name) || (o.parent && lookup(o.parent.name)) || o.name;
          const geom = o.geometry.clone(); geom.applyMatrix4(o.matrixWorld);
          const ca = geom.getAttribute('color'), color = new THREE.Color(0.7, 0.7, 0.7);
          const k = ca && ca.normalized && ca.array instanceof Uint8Array ? 1 / 255 : 1;   // r128 returns raw bytes
          if (ca) color.setRGB(ca.getX(0) * k, ca.getY(0) * k, ca.getZ(0) * k).convertSRGBToLinear();
          const sp = SPLIT.find((s) => s.re.test(name));
          if (sp) {
            makePart(tr, name + '|nut', subGeom(geom, (a, b, c) => sp.nut(a) && sp.nut(b) && sp.nut(c)), color);
            makePart(tr, name + '|bolt', subGeom(geom, (a, b, c) => !(sp.nut(a) && sp.nut(b) && sp.nut(c))), color);
          } else makePart(tr, name, geom, color);
        }
        if (tr.key === 'single') buildDummy(tr);
        tr.assyOf = {}; for (const [a, A] of Object.entries(tr.assy)) A.parts.forEach((n) => { tr.assyOf[n] = a; });
        tr.lidSet = new Set(tr.lid); tr.knobSet = new Set(tr.knobs); tr.springSet = new Set(tr.springs);
        tr.holders = {};
        for (const [a, A] of Object.entries(tr.assy)) {            // two bars under each board on the PCB bench
          const b = tr.parts[A.board]; if (!b) continue;
          const bot = b.c.z - b.size.z / 2 + A.at[2], h = bot - BENCH_Z, grp = new THREE.Group();
          for (const sx of [-1, 1]) {
            const m = new THREE.Mesh(new THREE.BoxGeometry(4, b.size.y * 0.55, h), MAT.holder);
            m.position.set(b.c.x + A.at[0] + sx * (b.size.x / 2 - 4), A.at[1], BENCH_Z + h / 2); grp.add(m);
          }
          grp.visible = false; tr.group.add(grp); tr.holders[a] = grp;
        }
        resolve(tr);
      }, reject);
    });
  }

  // ============================================================ state + poses
  const HINGE = new V3(-24.5, 0, 5.9), YAX = new V3(0, 1, 0), LID_OPEN = -110 * Math.PI / 180;
  const newState = () => ({ step: 0, task: 0, tool: null, mistakes: 0, log: [], t0: null, t1: null, finished: false,
    done: new Set(), skipped: new Set(), assyOff: {}, ttAtJig: false, lift: 0, lid: 0, played: false });
  function home(tr, p) {
    const st = tr.st, pos = p.c.clone(), quat = new Q(), scale = new V3(1, 1, 1);
    const a = tr.assyOf[p.name];
    if (a && st.assyOff[a]) pos.add(st.assyOff[a]);
    if ((a === 'TT' && st.ttAtJig) || tr.knobSet.has(p.name)) pos.z += st.lift;
    if (tr.springSet.has(p.name)) { const L0 = p.size.z, L = L0 + (st.ttAtJig ? st.lift : 3.5); scale.z = L / L0; pos.z = p.c.z - L0 / 2 + L / 2; }   // compressed in the CAD, free = +3.5
    if (tr.lidSet.has(p.name) && st.lid) { quat.setFromAxisAngle(YAX, st.lid); pos.sub(HINGE).applyQuaternion(quat).add(HINGE); }
    return { pos, quat, scale };
  }
  const setPose = (p, h) => { p.obj.position.copy(h.pos); p.obj.quaternion.copy(h.quat); p.obj.scale.copy(h.scale); };

  // ============================================================ tweens
  const tweens = new Set(); let instant = false, busy = 0;
  const ease = (k) => k * k * (3 - 2 * k);
  function tween(dur, update) {
    return new Promise((res) => {
      if (instant || dur <= 0) { update(1); res(); return; }
      tweens.add({ t0: performance.now(), dur: reduced ? dur * 0.35 : dur, update, res });
    });
  }
  function runTweens(now) { for (const tw of Array.from(tweens)) { const k = Math.min(1, (now - tw.t0) / tw.dur); tw.update(ease(k)); if (k >= 1) { tweens.delete(tw); tw.res(); } } }
  function finishTweens() { for (const tw of Array.from(tweens)) { tw.update(1); tweens.delete(tw); tw.res(); } }
  const sleep = (ms) => (instant ? Promise.resolve() : new Promise((r) => setTimeout(r, reduced ? ms * 0.4 : ms)));
  const AX = { top: new V3(0, 0, 1), bottom: new V3(0, 0, -1), '+y': new V3(0, 1, 0), '-y': new V3(0, -1, 0) };
  function pathTo(p0, p1, from, dist) {
    const pre = p1.clone().addScaledVector(AX[from || 'top'], dist || 14);
    if (from === 'bottom') return [p0, p0.clone().add(new V3(0, 0, -4)), pre, p1];
    const up = Math.max(p0.z, pre.z, p1.z) + 18;
    return [p0, new V3(p0.x, p0.y, up), new V3(pre.x, pre.y, Math.max(up, pre.z)), pre, p1];
  }
  function along(pts) {
    const L = [0]; for (let i = 1; i < pts.length; i++) L.push(L[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const tot = L[L.length - 1] || 1, out = new V3();
    const f = (e) => { const s = e * tot; let i = 1; while (i < L.length - 1 && L[i] < s) i++;
      return out.lerpVectors(pts[i - 1], pts[i], Math.min(1, Math.max(0, (s - L[i - 1]) / Math.max(1e-6, L[i] - L[i - 1])))); };
    f.tot = tot; f.last = L[L.length - 2] / tot; return f;
  }
  function moveTo(obj, h, from, opt) {
    const P = along(pathTo(obj.position.clone(), h.pos, from, opt && opt.dist));
    const q0 = obj.quaternion.clone(), s0 = obj.scale.clone(), qs = new Q(), spin = opt && opt.spin, ax = AX[from || 'top'];
    return tween(Math.min(1300, 450 + P.tot * 3), (e) => {
      obj.position.copy(P(e)); obj.quaternion.copy(q0).slerp(h.quat, e); obj.scale.lerpVectors(s0, h.scale, e);
      if (spin && e > P.last) { qs.setFromAxisAngle(ax, (1 - (e - P.last) / (1 - P.last)) * spin * Math.PI * 2); obj.quaternion.premultiply(qs); }
    });
  }

  // ============================================================ visuals
  function setMark(obj, sign) {
    let m = obj.userData.mark;
    if (!m) { m = new THREE.Mesh(MARK_GEO, MAT.mark); m.userData.fxChild = true; obj.add(m); obj.userData.mark = m; }
    m.position.set(0, 0, sign * 1.04);
  }
  function addSolder(p, side) {                     // fillet on the side opposite the flange (S/TB bottom face -1.6, TT top face 9.05)
    const ttb = tr.parts[T.tt], zf = side === 'top' ? (ttb ? ttb.c.z + ttb.size.z / 2 : 9.3) : -1.6, g = new THREE.CylinderGeometry(side === 'top' ? 0.42 : 0.95, side === 'top' ? 0.95 : 0.42, 0.55, 14);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(g, MAT.solder); m.userData.fxChild = true;
    m.position.set(0, 0, zf + (side === 'top' ? 0.275 : -0.275) - p.c.z); p.obj.add(m);
  }
  function mats(obj) { const out = []; obj.traverse((o) => { if (o.material && o.material.emissive && !o.userData.fxChild) out.push(o.material); }); return out; }
  const glowT = new Map();
  function glow(objs, hex, ms) {
    for (const o of objs) {
      mats(o).forEach((m) => m.emissive.setHex(hex));
      clearTimeout(glowT.get(o)); glowT.set(o, setTimeout(() => { glowT.delete(o); mats(o).forEach((m) => m.emissive.setHex(0)); }, ms));
    }
  }
  function cloneObj(src, material) {
    const ud = src.userData; src.userData = {};          // userData holds the part (circular): Object3D.clone JSON-copies it
    const o = src.clone(true); src.userData = ud;
    o.traverse((m) => {
      if (m.userData.fxChild) { m.visible = false; return; }
      if (m.isMesh) m.material = material ? material() : m.material.clone();
    });
    o.userData = {}; o.visible = true; return o;
  }
  function makeProbe(mat) {
    const g = new THREE.Group();
    const tip = new THREE.ConeGeometry(0.55, 3, 12); tip.rotateX(-Math.PI / 2); tip.translate(0, 0, 1.5);
    const body = new THREE.CylinderGeometry(0.75, 0.75, 22, 12); body.rotateX(Math.PI / 2); body.translate(0, 0, 14);
    g.add(new THREE.Mesh(tip, MAT.tip), new THREE.Mesh(body, mat)); g.visible = false; fx.add(g); return g;
  }
  const probes = { red: makeProbe(MAT.red), black: makeProbe(MAT.black) };

  // ============================================================ UI refs
  const ui = { tools: $('tools'), chips: $('chips'), hud: $('hud'), bar: $('bar'), meta: $('meta'), card: $('card'),
    picks: $('picks'), fb: $('fb'), auto: $('auto'), restart: $('restart'), skip: $('skip'), steps: $('steps'), notes: $('notes') };
  ui.tools.innerHTML = TOOLS.map((t) => `<button class="tool" type="button" data-tool="${t.id}" aria-pressed="false" title="${esc(t.full)}"><svg viewBox="0 0 24 24" aria-hidden="true">${t.svg}</svg><span>${esc(t.name)}</span></button>`).join('');

  let tr = null;                     // the active track
  let view = null;                   // per-task view: { entries, ghosts, pickables, chips }
  const stepNow = () => tr.steps[tr.st.step];
  const taskNow = () => { const s = stepNow(); return s ? s.tasks[tr.st.task] : null; };
  function feedback(kind, text) { ui.fb.className = 'fb ' + (kind || ''); ui.fb.textContent = (kind === 'bad' ? '✕ ' : kind === 'ok' ? '✓ ' : '') + text; }
  function startClock() { if (!tr.st.t0 && !auto.on && !instant) tr.st.t0 = Date.now(); }
  function mistake(text, objs) {
    tr.st.mistakes++; tr.st.log.push(text); feedback('bad', text);
    if (objs) { glow(objs, 0x7a1010, 500); objs.forEach((o) => shakeObj(o)); }
    renderMeta();
  }
  function shakeObj(o) { const x0 = o.position.x; tween(380, (e) => { o.position.x = x0 + Math.sin(e * Math.PI * 6) * (1 - e) * 1.2; }); }

  // ============================================================ task setup
  function seeded(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }
  function shuffle(a, seed) { const r = seeded(seed), b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; }
  const hash = (s) => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };
  function partOf(name) {
    const m = /^(tandem|single):(.*)$/.exec(name);
    return m ? (TRACKS[m[1]].parts || {})[m[2]] : tr.parts[name];
  }
  function clearView() {
    if (view) {
      view.chips.forEach((c) => c.el.remove());
      view.probeItems.forEach((x) => { const p = partOf(x.it.part); if (p) mats(p.obj).forEach((m) => m.emissive.setRGB(0, 0, 0)); });
      for (const e of view.entries) if (!e.ok || e.it.assy || e.it.act) continue; else e.parts.forEach((p) => { if (!p.placed) p.obj.visible = false; });
    }
    while (fx.children.length > 2) fx.remove(fx.children[2]);      // keep the two probes
    probes.red.visible = probes.black.visible = false;
    view = { entries: [], ghosts: [], pickables: [], chips: [], probeItems: [] };
  }
  function rotSize(box, q) {
    const b = new THREE.Box3(), v = new V3();
    for (let i = 0; i < 8; i++) b.expandByPoint(v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyQuaternion(q));
    return b;
  }
  function cellFor(e) {                     // tray footprint of an entry and a place(cx, cy) that poses its objects on the bench
    const objs = e.objs, q = e.rot;
    if (e.layout === 'unit') {
      const parts = e.src, u = new THREE.Box3();
      parts.forEach((p) => u.union(p.box.clone().translate(p.c)));
      const uc = u.getCenter(new V3()), rb = rotSize(u.clone().translate(uc.clone().negate()), q);
      return { w: Math.max(16, rb.max.x - rb.min.x), d: rb.max.y - rb.min.y, place(cx, cy) {
        objs.forEach((o, i) => { o.position.copy(parts[i].c).sub(uc).applyQuaternion(q).add(new V3(cx - (rb.max.x + rb.min.x) / 2, cy - (rb.max.y + rb.min.y) / 2, BENCH_Z - rb.min.z + 0.05)); o.quaternion.copy(q); o.scale.set(1, 1, 1); });
      } };
    }
    const sz = new V3(); e.src.forEach((p) => { const b = rotSize(p.box, q); sz.max(b.getSize(new V3())); });
    const n = objs.length, cols = n <= 4 ? n : n <= 6 ? 3 : 4, rows = Math.ceil(n / cols), gx = sz.x + 2.4, gy = sz.y + 2.4;
    return { w: Math.max(16, cols * gx - 2.4), d: rows * gy - 2.4, place(cx, cy) {
      objs.forEach((o, i) => { const c = i % cols, r = Math.floor(i / cols);
        o.position.set(cx + (c - (cols - 1) / 2) * gx, cy + ((rows - 1) / 2 - r) * gy, BENCH_Z + rotSize(e.src[i].box, q).getSize(new V3()).z / 2 + 0.05);
        o.quaternion.copy(q); o.scale.set(1, 1, 1); });
    } };
  }
  function spotBox(key) {                   // CAD box of a work spot: the jig at the origin or a PCB bench
    const b = new THREE.Box3();
    if (key === 'jig') {
      for (const p of Object.values(tr.parts)) if (!/station|groove rod|sample|vacuum|^@/.test(p.name)) b.union(p.box.clone().translate(p.c));
      return b.intersect(new THREE.Box3(new V3(-32, -36, -9), new V3(32, 44, 16)));
    }
    const A = tr.assy[key]; A.parts.forEach((n) => { const p = tr.parts[n]; b.union(p.box.clone().translate(p.c).translate(new V3(...A.at))); });
    return b;
  }
  function layoutRow(entries, box) {
    const cells = entries.map(cellFor), gap = 9, W = cells.reduce((s, c) => s + c.w, 0) + gap * (cells.length - 1);
    const maxD = Math.max(...cells.map((c) => c.d)), y = box.min.y - 12 - maxD / 2;
    let x = (box.min.x + box.max.x) / 2 - W / 2;
    cells.forEach((c) => { c.place(x + c.w / 2, y); x += c.w + gap; });
  }
  function layoutKit(entries) {             // shelves centred on the jig spot
    const cells = entries.map(cellFor), Wmax = 175, gap = 8; let x = 0, y = 0, rowD = 0; const rows = [[]];
    cells.forEach((c) => { if (x > 0 && x + c.w > Wmax) { rows.push([]); x = 0; } rows[rows.length - 1].push(c); x += c.w + gap; });
    const total = rows.reduce((s, r) => s + Math.max(...r.map((c) => c.d)) + 10, -10); y = total / 2 - 10;
    for (const r of rows) {
      rowD = Math.max(...r.map((c) => c.d)); const W = r.reduce((s, c) => s + c.w, 0) + gap * (r.length - 1); x = -W / 2;
      r.forEach((c) => { c.place(x + c.w / 2, y - rowD / 2); x += c.w + gap; }); y -= rowD + 10;
    }
  }
  function addChip(text, anchorFn, onClick, cls) {
    const el = document.createElement(onClick ? 'button' : 'div'); el.className = 'chip' + (cls ? ' ' + cls : ''); el.textContent = text;
    if (onClick) { el.type = 'button'; el.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); }); }
    ui.chips.appendChild(el); const c = { el, anchor: anchorFn }; view.chips.push(c); return c;
  }
  const topOf = (objs) => () => { const b = new THREE.Box3(); objs.forEach((o) => b.expandByObject(o)); return new V3((b.min.x + b.max.x) / 2, b.max.y, (b.min.z + b.max.z) / 2); };

  function setupTask() {
    clearView();
    const step = stepNow(), task = taskNow(); if (!task) return;
    const focus = task.focus || step.focus;
    bench.visible = grid.visible = (task.view || step.view) !== 'below';
    if (task.t === 'kit') {
      task.rows.forEach((row, i) => {
        const parts = row.parts.map(partOf).filter(Boolean);
        const e = { kind: 'kit', row, i, ok: true, it: row, parts, src: parts, objs: parts.map((p) => p.obj), rot: new Q(), layout: 'grid', done: false };
        parts.forEach((p) => { p.obj.visible = true; });
        view.entries.push(e);
        e.objs.forEach((o) => view.pickables.push({ obj: o, on: () => onKit(e) }));
      });
      layoutKit(view.entries.filter((e) => e.objs.length));
    } else if (task.t === 'pick') {
      const list = [...task.items.map((it) => ({ it, ok: true })), ...(task.decoys || []).map((it) => ({ it, ok: false }))];
      const entries = shuffle(list, hash(step.id + tr.st.task));
      const trayEntries = [];
      entries.forEach((e, i) => {
        e.n = i + 1; e.done = false;
        if (e.ok && (e.it.assy || e.it.act)) {
          const names = e.it.assy ? tr.assy[e.it.assy].parts : e.it.parts;
          e.parts = names.map(partOf).filter((p) => p && p.placed); e.objs = e.parts.map((p) => p.obj);
          if (e.it.assy) {                           // ghost of the board where it lands
            const b = tr.parts[tr.assy[e.it.assy].board], g = cloneObj(b.obj, ghostMat);
            g.position.copy(b.c); if (e.it.assy === 'TT') g.position.z += tr.assy.TT.lift; g.quaternion.set(0, 0, 0, 1); fx.add(g); view.ghosts.push(g);
          }
        } else {
          const src = (e.ok ? e.it.parts : e.it.like).map(partOf).filter(Boolean);
          e.src = src; e.parts = e.ok ? src : [];
          e.objs = e.ok ? src.map((p) => p.obj) : src.map((p) => { const o = cloneObj(p.obj); fx.add(o); return o; });
          e.objs.forEach((o) => { o.visible = true; });
          const q = new Q(); if (e.it.flip) q.setFromAxisAngle(new V3(1, 0, 0), Math.PI);
          if (e.it.rotZ) q.premultiply(new Q().setFromAxisAngle(new V3(0, 0, 1), e.it.rotZ * Math.PI / 180));
          e.rot = q;
          e.layout = e.it.layout || (src.length > 1 && !src.every((p) => p.size.distanceTo(src[0].size) < 0.05) ? 'unit' : 'grid');
          if (e.it.mark) e.objs.forEach((o) => setMark(o, e.it.mark));
          trayEntries.push(e);
          if (e.ok) e.parts.forEach((p, k) => {        // ghosts where the parts go
            const g = cloneObj(p.obj, ghostMat); const h = home(tr, p); g.position.copy(h.pos); g.quaternion.copy(h.quat); g.scale.copy(h.scale);
            fx.add(g); view.ghosts.push(g);
            if (task.target) { g.userData.target = { e, k }; view.pickables.push({ obj: g, on: () => onTarget(e, k) }); }
          });
        }
        view.entries.push(e);
        e.objs.forEach((o) => view.pickables.push({ obj: o, on: () => onEntry(e) }));
        addChip(String(e.n), topOf(e.objs), () => onEntry(e));
      });
      layoutRow(trayEntries, spotBox(focus === 'kit' ? 'jig' : focus));
      if (task.target) view.entries.filter((e) => e.ok).forEach((e) => e.parts.forEach((p, k) => {
        const g = view.ghosts.find((x) => x.userData.target && x.userData.target.e === e && x.userData.target.k === k);
        e.tchips = e.tchips || []; e.tchips[k] = addChip(e.it.targets[k], topOf([g]), () => onTarget(e, k));
      }));
    } else if (task.t === 'probe' || task.t === 'inspect') {
      view.probeItems = task.items.filter((it) => !it.needs || (partOf(it.needs) || {}).placed).map((it, i) => ({ it, i, done: false }));
      const seen = new Set();
      for (const pi of view.probeItems) { const p = partOf(pi.it.part); if (p && !seen.has(p)) { seen.add(p); view.pickables.push({ obj: p.obj, on: () => onProbePart(p) }); } }
    }
    renderAll(); frame(true);
  }

  // ============================================================ actions
  function toolOk() {
    const step = stepNow();
    if (!step.tool) return true;
    if (tr.st.tool === step.tool) return true;
    const btn = ui.tools.querySelector(`[data-tool="${step.tool}"]`);
    if (!tr.st.tool) { feedback('bad', '먼저 아래 도구 줄에서 도구를 고른다.'); ui.tools.querySelectorAll('.tool').forEach((b) => { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); }); return false; }
    mistake(`${TOOL[tr.st.tool].full}가 아니다. 이 단계는 ${TOOL[step.tool].full}.` + (step.toolWhy ? ' ' + step.toolWhy : ''));
    if (btn) { btn.classList.remove('shake'); void btn.offsetWidth; btn.classList.add('shake'); }
    return false;
  }
  function onTool(id, quiet) {
    if (!tr || tr.st.finished) return;
    if (!quiet) { stopAuto(); startClock(); }
    tr.st.tool = id; renderTools();
    const step = stepNow();
    if (!quiet && step.tool && id !== step.tool) mistake(`${TOOL[id].full}는 이 단계에 쓰지 않는다. ` + (step.toolWhy || `이 단계는 ${TOOL[step.tool].full}.`));
    else if (!quiet && step.tool) feedback('ok', `${TOOL[id].full} 들었다.`);
  }
  async function onEntry(e, fromAuto) {
    if (busy || !view || !view.entries.includes(e)) return;
    if (!fromAuto) { stopAuto(); startClock(); }
    const task = taskNow();
    if (task.t === 'kit') return onKit(e);
    if (!toolOk()) return;
    if (!e.ok) { mistake(e.it.hint, e.objs); return; }
    if (e.done) return;
    if (task.target) {
      if (!e.selected) { e.selected = true; e.objs.forEach((o) => { if (!o.userData.part.placed) o.position.z += 3; }); feedback('ok', `${e.it.label}을(를) 골랐다. 빛나는 자리를 누른다.`); renderPicks(); }
      return;
    }
    if (task.ordered) { const first = view.entries.find((x) => x.ok && !x.done); if (first !== e) { mistake(task.orderHint); return; } }
    busy++;
    try {
      if (e.it.assy) await moveAssy(e.it.assy);
      else if (e.it.act === 'lidClose') await setLid(0);
      else await placeParts(e.parts, e.it);
    } finally { busy--; }
    e.done = true; feedback('ok', e.it.label + ' 끝.');
    afterProgress();
  }
  async function onTarget(e, k) {
    if (busy || !view || !view.entries.includes(e)) return;
    if (!auto.running) { stopAuto(); startClock(); }
    if (!toolOk()) return;
    if (!e.selected) { mistake('먼저 번호를 눌러 맞는 부품을 고른다.'); return; }
    const p = e.parts[k]; if (p.placed) return;
    const task = taskNow(), seq = e.seq || (e.seq = []);
    if (task.rule === 'diagonal' && seq.length % 2 === 1 && k !== 3 - seq[seq.length - 1]) { mistake('대각선으로: 방금 조인 나사의 맞은편 모서리를 조인다(판이 한쪽으로 기울지 않게).', [view.ghosts.find((g) => g.userData.target && g.userData.target.e === e && g.userData.target.k === k)]); return; }
    busy++;
    try { await placeParts([p], e.it); } finally { busy--; }
    seq.push(k); if (e.tchips && e.tchips[k]) e.tchips[k].el.classList.add('done');
    const g = view.ghosts.find((x) => x.userData.target && x.userData.target.e === e && x.userData.target.k === k); if (g) g.visible = false;
    if (e.parts.every((x) => x.placed)) { e.done = true; feedback('ok', e.it.label + ' 끝.'); afterProgress(); } else { feedback('ok', e.it.targets[k] + ' 물렸다.'); renderPicks(); }
  }
  async function placeParts(parts, it) {
    const unit = it.layout === 'unit' && parts.length > 1;
    if (unit) {                               // rigid move: the parts keep their spacing
      const ref = parts[0], offs = parts.map((p) => p.obj.position.clone().sub(ref.obj.position)), h = home(tr, ref);
      const P = along(pathTo(ref.obj.position.clone(), h.pos, it.from));
      await tween(Math.min(1300, 450 + P.tot * 3), (e) => { const at = P(e); parts.forEach((p, i) => p.obj.position.copy(at).add(offs[i])); });
      parts.forEach((p) => { p.placed = true; setPose(p, home(tr, p)); });
    } else {
      await Promise.all(parts.map((p, i) => sleep(i * 80).then(() => moveTo(p.obj, home(tr, p), it.from, it)).then(() => {
        p.placed = true; setPose(p, home(tr, p)); if (it.solder) addSolder(p, it.solder);
      })));
    }
    if (!instant) glow(parts.map((p) => p.obj), 0x0d4022, 450);
  }
  async function placeEnter(names, from) {
    const parts = names.map(partOf).filter((p) => p && !p.placed);
    for (const p of parts) { const h = home(tr, p); p.obj.visible = true; p.obj.position.copy(h.pos).add(new V3(0, 0, 30)); p.obj.quaternion.copy(h.quat); }
    await placeParts(parts, { from: from || 'top' });
  }
  async function moveAssy(key) {
    const A = tr.assy[key], st = tr.st, parts = A.parts.map(partOf).filter((p) => p.placed), board = tr.parts[A.board];
    st.assyOff[key] = new V3(); if (key === 'TT') { st.ttAtJig = true; st.lift = A.lift; }
    const offs = parts.map((p) => p.obj.position.clone().sub(board.obj.position));
    const P = along(pathTo(board.obj.position.clone(), home(tr, board).pos, 'top', 6));
    await tween(1250, (e) => { const at = P(e); parts.forEach((p, i) => p.obj.position.copy(at).add(offs[i])); });
    parts.forEach((p) => setPose(p, home(tr, p))); if (tr.holders[key]) tr.holders[key].visible = false;
    if (key === 'TT') applyLift();
  }
  function applyLift() { for (const p of Object.values(tr.parts)) if (p.placed && ((tr.assyOf[p.name] === 'TT') || tr.knobSet.has(p.name) || tr.springSet.has(p.name))) setPose(p, home(tr, p)); }
  async function setLift(L) { const a = tr.st.lift; await tween(700, (e) => { tr.st.lift = a + (L - a) * e; applyLift(); }); }
  async function setLid(angle) {
    const a = tr.st.lid, parts = tr.lid.map(partOf).filter((p) => p && p.placed);
    await tween(800, (e) => { tr.st.lid = a + (angle - a) * e; parts.forEach((p) => setPose(p, home(tr, p))); });
  }
  async function benchBoard(key) {
    const A = tr.assy[key]; tr.st.assyOff[key] = new V3(...A.at);
    if (tr.holders[key]) tr.holders[key].visible = true;
    await placeEnter([A.board, ...(A.jlc || [])]);
  }
  async function runOps(ops) {
    for (const op of ops || []) {
      if (op[0] === 'bench') await benchBoard(op[1]);
      else if (op[0] === 'place') await placeEnter(op[1], op[2]);
      else if (op[0] === 'lid') await setLid(op[1] === 'open' ? LID_OPEN : 0);
      else if (op[0] === 'lift') await setLift(op[1]);
    }
  }
  async function onProbePart(p, fromAuto) {
    const pi = view.probeItems.find((x) => !x.done && partOf(x.it.part) === p);
    if (pi) return onProbe(pi, fromAuto);
  }
  function probePoint(p, sign) {
    const n = p.name, b = new THREE.Box3().setFromObject(p.obj); const m = cad.matrixWorld.clone().invert(); b.applyMatrix4(m);
    const c = b.getCenter(new V3());
    if (/^front pin/.test(n)) return { at: new V3(c.x, c.y, b.min.z), dir: new V3(0, 0, 1) };
    if (/DB15|SMA/.test(n)) return { at: new V3(c.x + sign * 2.5, b.max.y, c.z), dir: new V3(0, -1, 0) };
    if (/FFC/.test(n)) return { at: new V3(c.x + sign * 2, b.min.y, c.z), dir: new V3(0, 1, 0) };
    return { at: new V3(c.x, c.y, b.max.z), dir: new V3(0, 0, -1) };
  }
  async function onProbe(pi, fromAuto) {
    if (busy || !view.probeItems.includes(pi)) return;
    if (!fromAuto) { stopAuto(); startClock(); }
    if (!toolOk() || pi.done) return;
    const task = taskNow(), p = partOf(pi.it.part), ref = partOf(pi.it.ref || task.ref || pi.it.part);
    busy++;
    try {
      scene.updateMatrixWorld(true);
      const moves = task.t === 'inspect' ? [] : [[probes.red, probePoint(p, 1)], [probes.black, probePoint(ref, -1)]].map(([pr, t]) => {
        const q = new Q().setFromUnitVectors(new V3(0, 0, -1), t.dir), start = t.at.clone().addScaledVector(t.dir, -25);
        if (!pr.visible) { pr.position.copy(start); pr.quaternion.copy(q); pr.visible = true; }
        const p0 = pr.position.clone(), q0 = pr.quaternion.clone();
        return tween(320, (e) => { pr.position.lerpVectors(p0, t.at, e); pr.quaternion.copy(q0).slerp(q, e); });
      });
      await Promise.all(moves);
      pi.done = true;
      if (!instant) { const chip = addChip(pi.it.read, task.t === 'inspect' ? topOf([p.obj]) : () => probes.red.localToWorld(new V3(0, 0, 9)), null, 'read'); setTimeout(() => { chip.el.remove(); view.chips = view.chips.filter((c) => c !== chip); }, 1300); }
      feedback('ok', `${pi.it.label}: ${pi.it.read}`);
    } finally { busy--; }
    if (view.probeItems.every((x) => x.done)) afterProgress(); else renderPicks();
  }
  function onKit(e) {
    if (!view.entries.includes(e)) return;
    e.done = !e.done; if (e.objs.length) glow(e.objs, 0x3a2a00, 1300);
    feedback('', `${e.row.label} × ${e.row.qty}`); renderPicks();
  }
  async function kitAll() { view.entries.forEach((e) => { e.done = true; }); renderPicks(); await sleep(250); afterProgress(); }
  async function onAnswer(i, fromAuto) {
    const task = taskNow(); if (!task || task.t !== 'quiz' || busy) return;
    if (!fromAuto) { stopAuto(); startClock(); }
    const o = task.opts[i];
    if (!o.ok) { mistake(o.hint); return; }
    feedback('ok', o.t); afterProgress();
  }
  function afterProgress() {
    const task = taskNow(); if (!task) return;
    let complete = false;
    if (task.t === 'pick') complete = view.entries.every((e) => !e.ok || e.done);
    else if (task.t === 'probe' || task.t === 'inspect') complete = view.probeItems.every((x) => x.done);
    else complete = true;
    if (!complete) { renderPicks(); return; }
    completeTask();
  }
  let advancing = null;
  function completeTask() {
    const task = taskNow();
    advancing = (async () => {
      busy++;
      try { await runOps(task.after); await sleep(350); } finally { busy--; }
      tr.st.task++;
      if (tr.st.task < stepNow().tasks.length) { setupTask(); return; }
      tr.st.done.add(stepNow().id); await nextStep();
    })();
    return advancing;
  }
  async function nextStep() {
    if (tr.st.step + 1 >= tr.steps.length) { finish(); return; }
    await enterStep(tr.st.step + 1);
  }
  async function enterStep(i) {
    const st = tr.st; st.step = i; st.task = 0;
    clearView(); renderAll();
    const step = stepNow(); bench.visible = grid.visible = step.view !== 'below';
    if (step.tasks[0] && step.tasks[0].t !== 'kit') hideKit();
    frameSpot(step.focus, step.view);
    busy++; try { await runOps(step.enter); } finally { busy--; }
    setupTask();
  }
  function hideKit() { for (const p of Object.values(tr.parts)) if (!p.placed) p.obj.visible = false; }
  async function skipStep() {
    const step = stepNow(); if (!step || !step.optional || busy) return;
    stopAuto(); tr.st.skipped.add(step.id); feedback('', step.title + ': 건너뜀 (' + step.optional + ')');
    clearView(); hideKit(); await nextStep();
  }
  function finish() {
    const st = tr.st; st.finished = true; st.t1 = Date.now(); clearView(); hideKit();
    probes.red.visible = probes.black.visible = false; bench.visible = grid.visible = true;
    if (st.t0 && !st.played) { try { const k = 'asm-best-' + tr.key, best = +localStorage.getItem(k) || 0, t = st.t1 - st.t0; if (!best || t < best) localStorage.setItem(k, String(t)); } catch (e) { /* storage off */ } }
    renderAll(); frameSpot('jig', 'iso');
  }
  function resetTrack(t) {
    finishTweens(); busy = 0;
    for (const p of Object.values(t.parts)) {
      p.placed = false; p.obj.visible = false; p.obj.scale.set(1, 1, 1); p.obj.quaternion.set(0, 0, 0, 1);
      for (const ch of p.obj.children.slice()) if (ch.userData.fxChild) p.obj.remove(ch);
      p.obj.userData.mark = null;
    }
    Object.values(t.holders).forEach((h) => { h.visible = false; });
    t.st = newState();
  }

  // ============================================================ auto (보기만) + test runner
  const auto = { on: false, token: 0, running: false };
  function stopAuto() { if (auto.on) { auto.on = false; auto.token++; renderCtrl(); } }
  async function solveTask() {             // does the current task the right way (used by 보기만, jumps and tests)
    const step = stepNow(), task = taskNow(); if (!task) return;
    if (step.tool && tr.st.tool !== step.tool) { onTool(step.tool, true); await sleep(380); }
    if (task.t === 'kit') { await sleep(300); await kitAll(); return; }
    if (task.t === 'quiz') { const i = task.opts.findIndex((o) => o.ok); await sleep(600); await onAnswer(i, true); return; }
    if (task.t === 'probe' || task.t === 'inspect') { for (const pi of view.probeItems.slice()) { if (!auto.on && !instant) return; await onProbe(pi, true); await sleep(160); } return; }
    const ents = view.entries.filter((e) => e.ok);
    for (const e of ents) {
      if (!auto.on && !instant) return;
      if (task.target) {
        await onEntry(e, true); await sleep(250);
        const order = task.rule === 'diagonal' ? [0, 3, 1, 2] : e.parts.map((_, k) => k);
        for (const k of order) { if (!auto.on && !instant) return; auto.running = true; await onTarget(e, k); auto.running = false; await sleep(200); }
      } else { await onEntry(e, true); await sleep(200); }
    }
  }
  async function untilIdle() { while (advancing) { const a = advancing; await a; if (a === advancing) advancing = null; } }
  async function play() {
    if (tr.st.finished) { resetTrack(tr); await enterStep(0); }
    auto.on = true; const my = ++auto.token; tr.st.played = true; renderCtrl();
    while (auto.on && my === auto.token && !tr.st.finished) {
      const s0 = tr.st.step, k0 = tr.st.task;
      await solveTask(); await untilIdle();
      if (s0 === tr.st.step && k0 === tr.st.task) { await sleep(100); if (busy === 0 && s0 === tr.st.step && k0 === tr.st.task) break; }
      await sleep(250);
    }
    if (my === auto.token) { auto.on = false; renderCtrl(); }
  }
  async function jumpTo(i) {
    if (i === tr.st.step && !tr.st.finished) return;
    stopAuto(); finishTweens(); await untilIdle();
    const keep = { mistakes: tr.st.mistakes, log: tr.st.log, t0: tr.st.t0, tool: tr.st.tool };
    instant = true;
    try {
      resetTrack(tr); Object.assign(tr.st, keep); await enterStep(0);
      let guard = 0;
      while (tr.st.step < i && !tr.st.finished && guard++ < 400) { await solveTask(); await untilIdle(); }
    } finally { instant = false; }
    tr.st.played = true; setupTask();
  }
  async function runAll(key) {             // test: both tracks complete step by step with no errors
    const errors = []; const prev = tr.key;
    await showTrack(key);
    instant = true;
    try {
      resetTrack(tr); await enterStep(0);
      let guard = 0;
      while (!tr.st.finished && guard++ < 500) {
        const s0 = tr.st.step, k0 = tr.st.task;
        await solveTask(); await untilIdle();
        if (!tr.st.finished && s0 === tr.st.step && k0 === tr.st.task) { errors.push('stuck at ' + stepNow().id + ' task ' + k0); break; }
      }
    } catch (err) { errors.push(String(err && err.stack || err)); }
    instant = false;
    const res = { track: key, finished: tr.st.finished, steps: tr.steps.length, done: tr.st.done.size, skipped: tr.st.skipped.size,
      mistakes: tr.st.mistakes, placed: Object.values(tr.parts).filter((p) => p.placed).length, errors };
    if (prev !== key) await showTrack(prev);
    return res;
  }
  function namesOf(t) {
    const out = new Set(), add = (n) => n && out.add(n);
    for (const s of t.steps) {
      (s.enter || []).forEach((op) => Array.isArray(op[1]) && op[1].forEach(add));
      for (const k of s.tasks) {
        (k.rows || []).forEach((r) => r.parts.forEach(add));
        [...(k.items || []), ...(k.decoys || [])].forEach((it) => { (it.parts || []).forEach(add); (it.like || []).forEach(add); add(it.part); add(it.ref); add(it.needs); });
        add(k.ref);
      }
    }
    Object.values(t.assy).forEach((A) => A.parts.forEach(add)); t.lid.forEach(add); t.knobs.forEach(add); t.springs.forEach(add);
    return out;
  }
  function validate() {
    const missing = [];
    for (const t of Object.values(TRACKS)) for (const n of namesOf(t)) {
      const m = /^(tandem|single):(.*)$/.exec(n), tt = m ? TRACKS[m[1]] : t, nm = m ? m[2] : n;
      if (nm.startsWith('@')) { if (!tt.parts[nm]) missing.push(t.key + ': ' + n); continue; }
      const base = nm.replace(/\|(bolt|nut)$/, '');
      if (!tt.raw.has(base) || !tt.parts[nm]) missing.push(t.key + ': ' + n);
    }
    return missing;
  }

  // ============================================================ camera
  const VIEWS = { top: [0.3, 1.0, 0.72], iso: [0.55, 0.62, 0.78], below: [0.42, -0.62, 0.92], front: [0.26, 0.42, 1.0] };
  let camAnim = 0;
  function frameBox(box, viewKey, fast) {
    if (box.isEmpty()) return;
    const r0 = canvas.getBoundingClientRect(), H = Math.max(1, r0.height);
    const sphere = box.getBoundingSphere(new THREE.Sphere()), r = Math.max(sphere.radius, 14);
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2, vfE = Math.atan(Math.tan(vf) * Math.max(0.4, (H - 100) / H)), hf = Math.atan(Math.tan(vf) * camera.aspect);
    const dist = r / Math.sin(Math.min(vfE, hf));
    const dir = new V3(...VIEWS[viewKey || 'iso']).normalize();
    const fwd = dir.clone().negate(), right = new V3().crossVectors(fwd, new V3(0, 1, 0)).normalize(), up = new V3().crossVectors(right, fwd);
    const target = sphere.center.clone().addScaledVector(up, -(((62 - 30) / 2) / H) * 2 * dist * Math.tan(vf));
    const pos = target.clone().addScaledVector(dir, dist);
    const id = ++camAnim;
    if (fast === 'now' || instant || reduced) { camera.position.copy(pos); controls.target.copy(target); return; }
    const p0 = camera.position.clone(), t0 = controls.target.clone(), start = performance.now();
    (function stepCam(now) { if (id !== camAnim) return; const k = Math.min(1, (now - start) / 650), e = ease(k);
      camera.position.lerpVectors(p0, pos, e); controls.target.lerpVectors(t0, target, e); if (k < 1) requestAnimationFrame(stepCam); })(start);
  }
  function cadToWorld(b) { scene.updateMatrixWorld(true); return b.clone().applyMatrix4(cad.matrixWorld); }
  function frameSpot(focus, viewKey) { if (!tr) return; frameBox(cadToWorld(focus === 'kit' ? new THREE.Box3(new V3(-90, -80, -8), new V3(90, 80, 10)) : spotBox(focus)), viewKey); }
  function frame() {
    if (!tr || !view) return;
    const step = stepNow(), task = taskNow();
    if (!task) { frameSpot('jig', 'iso'); return; }
    scene.updateMatrixWorld(true);
    const box = task.t === 'kit' ? new THREE.Box3() : cadToWorld(spotBox(task.focus || step.focus));
    for (const e of view.entries) e.objs.forEach((o) => box.expandByObject(o));
    view.ghosts.forEach((g) => box.expandByObject(g));
    frameBox(box, task.view || step.view);
  }

  // ============================================================ rendering
  const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
  function renderTools() { ui.tools.querySelectorAll('.tool').forEach((b) => b.setAttribute('aria-pressed', String(tr && b.dataset.tool === tr.st.tool))); }
  function renderMeta() {
    const st = tr.st, n = tr.steps.length, cur = st.finished ? n : st.step;
    ui.bar.innerHTML = tr.steps.map((s, i) => `<span class="${st.done.has(s.id) || st.skipped.has(s.id) || i < cur ? 'done' : i === cur ? 'cur' : ''}" title="${esc(s.title)}"></span>`).join('');
    const t = st.t0 ? fmt((st.t1 || Date.now()) - st.t0) : '00:00';
    const step = stepNow();
    ui.meta.innerHTML = `<span>${st.finished ? '끝' : `${cur + 1} / ${n} · ${esc(step.phase)}`}</span><span>${t} · 실수 ${st.mistakes}</span>`;
    ui.hud.textContent = (auto.on ? '보기만 · ' : '') + (st.finished ? `${tr.title} 끝 · ${t}` : `${cur + 1}/${n} · ${t} · 실수 ${st.mistakes}`);
  }
  function renderCard() {
    const st = tr.st;
    if (st.finished) {
      let best = 0; try { best = +localStorage.getItem('asm-best-' + tr.key) || 0; } catch (e) { best = 0; }
      const hints = Array.from(new Set(st.log));
      ui.card.innerHTML = `<p class="phase">끝</p><h2>${esc(tr.title)} 조립 끝</h2>` +
        `<p>${st.t0 ? '시간 ' + fmt(st.t1 - st.t0) + ' · ' : ''}실수 ${st.mistakes}${best ? ' · 가장 빠른 기록 ' + fmt(best) : ''}${st.skipped.size ? ' · 건너뜀 ' + st.skipped.size : ''}</p>` +
        (hints.length ? `<p class="tip">틀렸던 곳: ${hints.map(esc).join(' / ')}</p>` : '') +
        `<p class="tip" style="margin-top:10px">실물에서 마지막으로 볼 것</p><ul>${CHECK[tr.key].map((c, i) => `<li><label><input type="checkbox" id="ck${i}"><span>${esc(c)}</span></label></li>`).join('')}</ul>`;
      return;
    }
    const s = stepNow(), task = taskNow();
    ui.card.innerHTML = `<p class="phase">${esc(s.phase)} · ${st.step + 1} / ${tr.steps.length}</p><h2>${esc(s.title)}</h2><p>${esc(s.say)}</p>` +
      (s.tip ? `<p class="tip">${esc(s.tip)}</p>` : '') + (task && task.t === 'quiz' ? `<p style="margin-top:8px;font-weight:600">${esc(task.q)}</p>` : '');
  }
  function renderPicks() {
    const task = taskNow();
    if (tr.st.finished || !task || !view) { ui.picks.innerHTML = tr.st.finished ? `<button class="btn" data-act="other" type="button">${tr.key === 'single' ? '제작 탠덤 해 보기' : '제작 싱글 해 보기'}</button>` : ''; return; }
    let h = '';
    if (task.t === 'kit') {
      h = `<p class="lab">부품 (눌러서 찾기)</p>` + view.entries.map((e, i) => `<button class="pk kit${e.done ? ' done' : ''}" data-kit="${i}" type="button"><span class="n">${e.done ? '✓' : i + 1}</span><span>${esc(e.row.label)}</span><span class="q">${esc(e.row.qty)}</span></button>`).join('') +
        `<button class="btn" data-act="kitall" type="button">모두 있음</button>`;
    } else if (task.t === 'pick') {
      h = `<p class="lab">${task.target ? '부품 고르기 → 빛나는 자리' : '부품 쟁반 (번호 = 3D 번호)'}</p>` + view.entries.map((e, i) => `<button class="pk${e.done ? ' done' : ''}${e.selected && !e.done ? ' sel' : ''}" data-ent="${i}" type="button"><span class="n">${e.done ? '✓' : e.n}</span><span>${esc(e.it.label)}</span></button>`).join('');
      for (const e of view.entries) if (task.target && e.ok && e.selected) h += `<p class="lab">자리</p>` + e.it.targets.map((t, k) => `<button class="pk${e.parts[k].placed ? ' done' : ''}" data-tgt="${view.entries.indexOf(e)}:${k}" type="button"><span class="n">${e.parts[k].placed ? '✓' : k + 1}</span><span>${esc(t)}</span></button>`).join('');
    } else if (task.t === 'probe' || task.t === 'inspect') {
      h = `<p class="lab">${task.t === 'inspect' ? '확대경으로 보기 (빛나는 부품을 눌러도 된다)' : '재기 (빛나는 부품을 눌러도 된다)'}</p>` + view.probeItems.map((pi, i) => `<button class="pk${pi.done ? ' done' : ''}" data-prb="${i}" type="button"><span class="n">${pi.done ? '✓' : i + 1}</span><span>${esc(pi.it.label)}${pi.done ? `<span class="rd">${esc(pi.it.read)}</span>` : ''}</span></button>`).join('');
    } else if (task.t === 'quiz') {
      h = `<p class="lab">고르기</p>` + task.opts.map((o, i) => `<button class="pk" data-ans="${i}" type="button"><span class="n">${i + 1}</span><span>${esc(o.t)}</span></button>`).join('');
    }
    ui.picks.innerHTML = h;
    view.chips.forEach((c) => { const e = view.entries.find((x) => c.el.textContent === String(x.n)); if (e && e.done) c.el.classList.add('done'); });
  }
  function renderCtrl() {
    ui.auto.textContent = auto.on ? '멈춤 ❚❚' : (tr && tr.st.finished ? '다시 보기 ▶' : '보기만 ▶');
    const s = tr && !tr.st.finished && stepNow();
    ui.skip.hidden = !(s && s.optional); if (s && s.optional) ui.skip.textContent = '건너뛰기 (' + s.optional + ')';
    renderMeta();
  }
  function renderSteps() {
    let ph = '', h = '';
    tr.steps.forEach((s, i) => {
      if (s.phase !== ph) { ph = s.phase; h += `<li class="ph">${esc(ph)}</li>`; }
      const mark = tr.st.done.has(s.id) ? '✓' : tr.st.skipped.has(s.id) ? '–' : i === tr.st.step && !tr.st.finished ? '●' : '';
      h += `<li><button type="button" data-step="${i}" class="${i === tr.st.step && !tr.st.finished ? 'cur' : ''}"><span class="s">${mark}</span><span>${esc(s.title)}</span></button></li>`;
    });
    ui.steps.innerHTML = h;
    ui.notes.innerHTML = NOTES[tr.key].map((n) => `<li>${esc(n)}</li>`).join('');
  }
  function renderAll() { renderTools(); renderCard(); renderPicks(); renderCtrl(); renderSteps(); }

  // ============================================================ events
  ui.tools.addEventListener('click', (ev) => { const b = ev.target.closest('[data-tool]'); if (b) onTool(b.dataset.tool); });
  ui.picks.addEventListener('click', (ev) => {
    const b = ev.target.closest('button'); if (!b || !view) return;
    if (b.dataset.ent) onEntry(view.entries[+b.dataset.ent]);
    else if (b.dataset.tgt) { const [i, k] = b.dataset.tgt.split(':').map(Number); onTarget(view.entries[i], k); }
    else if (b.dataset.prb) onProbe(view.probeItems[+b.dataset.prb]);
    else if (b.dataset.ans) onAnswer(+b.dataset.ans);
    else if (b.dataset.kit) onKit(view.entries[+b.dataset.kit]);
    else if (b.dataset.act === 'kitall') { stopAuto(); startClock(); kitAll(); }
    else if (b.dataset.act === 'other') showTrack(tr.key === 'single' ? 'tandem' : 'single');
  });
  ui.auto.addEventListener('click', () => { if (auto.on) stopAuto(); else play(); });
  ui.restart.addEventListener('click', async () => { stopAuto(); await untilIdle(); resetTrack(tr); await enterStep(0); feedback('', '처음부터.'); });
  ui.skip.addEventListener('click', skipStep);
  ui.steps.addEventListener('click', (ev) => { const b = ev.target.closest('[data-step]'); if (b) jumpTo(+b.dataset.step); });
  $('refit').addEventListener('click', () => frame());
  ['single', 'tandem'].forEach((k) => $('tr-' + k).addEventListener('click', () => showTrack(k)));
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(); let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || !view) return; const d = Math.hypot(e.clientX - down.x, e.clientY - down.y), dt = performance.now() - down.t; down = null;
    if (d > 6 || dt > 700) return;
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    ndc.set(x / r.width * 2 - 1, -(y / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    const pk = view.pickables.filter((p) => p.obj.visible);
    const hits = ray.intersectObjects(pk.map((p) => p.obj), true);
    for (const h of hits) { let o = h.object; while (o) { const f = pk.find((p) => p.obj === o); if (f) { f.on(); return; } o = o.parent; } }
    let best = null, bd = 26; const v = new V3();                // touch tolerance: the nearest pickable within 26 px
    for (const p of pk) { new THREE.Box3().setFromObject(p.obj).getCenter(v).project(camera);
      const dd = Math.hypot((v.x + 1) / 2 * r.width - x, (1 - v.y) / 2 * r.height - y); if (v.z < 1 && dd < bd) { bd = dd; best = p; } }
    if (best) best.on();
  });

  async function showTrack(key) {
    stopAuto(); finishTweens(); await untilIdle();
    for (const t of Object.values(TRACKS)) if (t.group) t.group.visible = t.key === key;
    $('tr-single').setAttribute('aria-pressed', String(key === 'single')); $('tr-tandem').setAttribute('aria-pressed', String(key === 'tandem'));
    if (tr && tr.key !== key && view) clearView();
    tr = TRACKS[key];
    try { history.replaceState(null, '', '#' + key); } catch (e) { /* file:// */ }
    if (!tr.st) { resetTrack(tr); await enterStep(0); }
    else if (tr.st.finished) { renderAll(); frameSpot('jig', 'iso'); }
    else setupTask();
    feedback('', '');
  }

  // ============================================================ loop
  function resize() { const r = canvas.parentElement.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix(); }
  let refitT = 0, lastW = 0, lastH = 0;
  new ResizeObserver(() => { resize(); const r = canvas.parentElement.getBoundingClientRect();
    if (Math.abs(r.width - lastW) > 40 || Math.abs(r.height - lastH) > 40) { lastW = r.width; lastH = r.height; clearTimeout(refitT); refitT = setTimeout(() => frame(), 250); } }).observe(canvas.parentElement);
  resize();
  let lastMeta = 0;
  let lastTick = 0;
  setInterval(() => { const now = performance.now(); if (now - lastTick > 250) runTweens(now); }, 120);   // tweens still finish when frames are paused (hidden tab)
  function tick(now) {
    lastTick = now; runTweens(now); controls.update();
    if (view) {
      const pulse = 0.16 + 0.16 * (1 + Math.sin(now / 260)) / 2;
      view.ghosts.forEach((g) => g.traverse((m) => { if (m.material && m.material.isMeshBasicMaterial) m.material.opacity = pulse; }));
      if (view.probeItems.length) {
        const k = 0.25 + 0.35 * (1 + Math.sin(now / 220)) / 2;
        const all = new Set(view.probeItems.map((x) => partOf(x.it.part)).filter(Boolean));
        const hot = new Set(view.probeItems.filter((x) => !x.done).map((x) => partOf(x.it.part)));
        all.forEach((p) => { if (!glowT.has(p.obj)) mats(p.obj).forEach((m) => (hot.has(p) ? m.emissive.setRGB(k * 0.15, k * 0.5, k * 0.3) : m.emissive.setRGB(0, 0, 0))); });
      }
    }
    renderer.render(scene, camera);
    const r = canvas.getBoundingClientRect();
    if (view) for (const c of view.chips) {
      const w = c.anchor(); if (!w) continue; const v = w.clone().project(camera);
      const show = v.z < 1 && v.x > -1.05 && v.x < 1.05 && v.y > -1.05 && v.y < 1.1;
      c.el.style.display = show ? '' : 'none';
      if (show) { c.el.style.left = ((v.x + 1) / 2 * r.width) + 'px'; c.el.style.top = ((1 - v.y) / 2 * r.height) + 'px'; }
    }
    if (tr && now - lastMeta > 500) { lastMeta = now; renderMeta(); }
    requestAnimationFrame(tick);
  }

  // ============================================================ start
  applyTheme();
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  camera.position.set(120, 140, 170); controls.target.set(0, 0, 0);
  requestAnimationFrame(tick);
  Promise.all(Object.values(TRACKS).map(loadTrack)).then(async () => {
    statusEl.hidden = true;
    const key = /tandem/.test(location.hash) ? 'tandem' : 'single';
    await showTrack(key); setTimeout(() => frame(), 400);
    const miss = validate(); if (miss.length) console.warn('[assembly] names not in the GLB:', miss);
  }).catch((err) => { statusEl.textContent = '모델을 읽지 못했습니다. 새로 고침해 보세요.'; console.error(err); });

  window.__asm = { validate, runAll, tracks: TRACKS, state: () => tr && tr.st, step: () => tr && stepNow() && stepNow().id,
    pick: (i) => view && onEntry(view.entries[i]), tool: onTool, jumpTo, showTrack };
})();
