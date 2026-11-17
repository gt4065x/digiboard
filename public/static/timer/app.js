import { PHASE_LABEL, normalizeWorkout, buildSequence, totalSeconds, fmtTime, parseTime } from './core.js';

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ---------- 저장소 (휴대폰 안에만 저장) ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem('setgo.' + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem('setgo.' + key, JSON.stringify(value)); } catch { /* 저장 공간 없음 */ }
  },
};

const S = Object.assign(
  { sound: true, soundType: 'beep', volume: 0.7, voice: true, vibrate: true, flash: false, keepAwake: true, format: 'mmss' },
  store.get('settings', {}),
);
const fmt = (sec) => fmtTime(sec, S.format);

let workouts = store.get('workouts', null);
if (!Array.isArray(workouts) || !workouts.length) {
  workouts = [
    { id: uid(), name: '근력 인터벌', prepare: 10, work: 120, rest: 90, rounds: 5, cycles: 1, cycleRest: 0 },
    { id: uid(), name: '타바타 기본', prepare: 10, work: 20, rest: 10, rounds: 8, cycles: 1, cycleRest: 0 },
  ];
  store.set('workouts', workouts);
}
workouts = workouts.map(normalizeWorkout);
let selectedId = store.get('selected', workouts[0].id);
let history = store.get('history', []);

// ---------- 소리 · 음성 · 진동 · 깜빡임 ----------
let ac = null;
function audio() {
  if (!ac) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) ac = new Ctx();
  }
  if (ac && ac.state === 'suspended') ac.resume();
  return ac;
}
function tone(freq, at, dur) {
  const a = audio();
  if (!a) return;
  const t = a.currentTime + at;
  const osc = a.createOscillator();
  const gain = a.createGain();
  const kind = S.soundType;
  osc.type = kind === 'beep' ? 'square' : kind === 'bell' ? 'sine' : 'triangle';
  const d = kind === 'bell' ? dur * 3 : kind === 'wood' ? Math.min(dur, 0.09) : dur;
  const peak = Math.max(0.0002, S.volume * (kind === 'beep' ? 0.35 : 0.9));
  osc.frequency.setValueAtTime(freq, t);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + d);
  osc.connect(gain).connect(a.destination);
  osc.start(t);
  osc.stop(t + d + 0.05);
}
const SOUNDS = {
  tick: () => tone(660, 0, 0.12),
  work: () => { tone(880, 0, 0.18); tone(1175, 0.2, 0.35); },
  rest: () => { tone(880, 0, 0.18); tone(587, 0.2, 0.35); },
  done: () => { tone(784, 0, 0.2); tone(988, 0.22, 0.2); tone(1319, 0.44, 0.6); },
};
function speak(text) {
  if (!('speechSynthesis' in window)) return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    u.volume = S.volume;
    speechSynthesis.speak(u);
  } catch { /* 음성 미지원 기기 */ }
}
// kind: tick(3·2·1초) | work | rest | done
function cue(kind, say) {
  if (S.sound && S.volume > 0) SOUNDS[kind]();
  if (S.voice && say) speak(say);
  if (S.vibrate && navigator.vibrate) navigator.vibrate(kind === 'tick' ? 60 : kind === 'done' ? [200, 100, 200, 100, 400] : 250);
  if (S.flash && kind !== 'tick') {
    const f = $('#flash');
    f.classList.remove('go');
    void f.offsetWidth;
    f.classList.add('go');
  }
}

// ---------- 화면 켜짐 유지 ----------
let wakeLock = null;
const anyRunning = () => IV.running || ST.phase === 'working' || ST.phase === 'resting' || SW.running;
async function syncWake() {
  try {
    if (anyRunning() && S.keepAwake && 'wakeLock' in navigator) {
      if (!wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } else if (wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { /* 배터리 절약 모드 등에서는 거절될 수 있음 */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { syncWake(); tickAll(); }
});

function addHistory(entry) {
  history.unshift({ at: Date.now(), ...entry });
  history = history.slice(0, 200);
  store.set('history', history);
  renderHistory();
}

// ---------- 인터벌 타이머 ----------
const IV = { workout: null, seq: [], idx: 0, running: false, started: false, finished: false, endsAt: 0, left: 0, lastSec: null };
const RING = 2 * Math.PI * 45;

function currentWorkout() {
  return workouts.find((w) => w.id === selectedId) || workouts[0];
}
function loadWorkout() {
  IV.workout = currentWorkout();
  selectedId = IV.workout.id;
  store.set('selected', selectedId);
  IV.seq = buildSequence(IV.workout);
  resetInterval();
}
function resetInterval() {
  Object.assign(IV, { idx: 0, running: false, started: false, finished: false, lastSec: null, left: IV.seq[0].dur * 1000 });
  syncWake();
  renderInterval();
}
function announce(phase) {
  const say = phase.type === 'work' && IV.workout.rounds > 1 ? `${phase.round}라운드 운동` : PHASE_LABEL[phase.type];
  cue(phase.type === 'work' ? 'work' : 'rest', say);
}
function toggleInterval() {
  audio(); // 소리는 사용자가 누른 순간에 켜야 브라우저가 허용한다
  if (IV.finished) { resetInterval(); return; }
  if (IV.running) {
    IV.left = Math.max(0, IV.endsAt - Date.now());
    IV.running = false;
  } else {
    if (!IV.started) { IV.started = true; announce(IV.seq[0]); }
    IV.endsAt = Date.now() + IV.left;
    IV.running = true;
  }
  syncWake();
  renderInterval();
}
function jumpInterval(dir) {
  if (IV.finished) return;
  const next = IV.idx + dir;
  if (next >= IV.seq.length) { if (IV.started) finishInterval(); return; }
  IV.idx = Math.max(0, next);
  IV.left = IV.seq[IV.idx].dur * 1000;
  IV.endsAt = Date.now() + IV.left;
  IV.lastSec = null;
  if (IV.running) announce(IV.seq[IV.idx]);
  renderInterval();
}
function finishInterval() {
  Object.assign(IV, { running: false, finished: true, left: 0 });
  cue('done', '운동 완료. 수고하셨습니다');
  addHistory({ kind: '인터벌', name: IV.workout.name, sec: totalSeconds(IV.seq), detail: `${IV.workout.rounds}라운드 × ${IV.workout.cycles}사이클` });
  syncWake();
  renderInterval();
}
function tickInterval() {
  if (!IV.running) return;
  const now = Date.now();
  let left = IV.endsAt - now;
  let changed = false;
  // 화면이 잠시 멈췄다 돌아와도 실제 시각 기준으로 따라잡는다
  while (left <= 0) {
    if (IV.idx >= IV.seq.length - 1) { finishInterval(); return; }
    IV.idx++;
    IV.endsAt += IV.seq[IV.idx].dur * 1000;
    left = IV.endsAt - now;
    changed = true;
  }
  IV.left = left;
  const sec = Math.ceil(left / 1000);
  if (changed) announce(IV.seq[IV.idx]);
  else if (IV.lastSec !== null && sec !== IV.lastSec && sec <= 3) cue('tick');
  IV.lastSec = sec;
  renderInterval();
}
function setTime(el, text) {
  el.textContent = text;
  el.classList.toggle('long', text.length > 5);
}
function renderInterval() {
  const w = IV.workout;
  const phase = IV.seq[IV.idx];
  const next = IV.seq[IV.idx + 1];
  const stage = $('#iv-stage');
  const later = IV.seq.slice(IV.idx + 1).reduce((s, p) => s + p.dur, 0);

  stage.dataset.phase = IV.finished ? 'done' : IV.started ? phase.type : 'idle';
  stage.classList.toggle('paused', IV.started && !IV.running && !IV.finished);
  $('#iv-name').textContent = w.name;
  $('#iv-total').textContent = fmt(Math.ceil(IV.left / 1000) + later);
  $('#iv-label').textContent = IV.finished ? '완료!' : !IV.started ? '시작 전' : IV.running ? PHASE_LABEL[phase.type] : '일시정지';
  setTime($('#iv-time'), fmt(Math.ceil(IV.left / 1000)));
  $('#iv-next').textContent = IV.finished ? '수고하셨습니다' : next ? `다음 · ${PHASE_LABEL[next.type]} ${fmt(next.dur)}` : '마지막 구간';
  $('#iv-round').textContent = `${phase.round}/${w.rounds}`;
  $('#iv-cycle').textContent = `${phase.cycle}/${w.cycles}`;
  $('#iv-ring').style.strokeDashoffset = IV.finished ? 0 : RING * (IV.left / (phase.dur * 1000));
  $('#iv-toggle-icon').classList.toggle('pause', IV.running);
  $('#iv-toggle').setAttribute('aria-label', IV.running ? '일시정지' : IV.finished ? '다시 하기' : '시작');
  $('#iv-pick-name').textContent = w.name;
  $('#iv-pick-sum').textContent = summary(w);
}
function summary(w) {
  const parts = [`운동 ${fmt(w.work)}`, `휴식 ${fmt(w.rest)}`, `${w.rounds}라운드`];
  if (w.cycles > 1) parts.push(`${w.cycles}사이클`);
  return parts.join(' · ');
}

$('#iv-toggle').onclick = toggleInterval;
$('#iv-reset').onclick = resetInterval;
$('#iv-prev').onclick = () => jumpInterval(-1);
$('#iv-skip').onclick = () => jumpInterval(1);
$('#iv-pick').onclick = () => { renderWorkouts(); $('#dlg-workouts').showModal(); };

// ---------- 내 운동 목록 · 편집 ----------
function renderWorkouts() {
  $('#wk-list').innerHTML = workouts.map((w) => `
    <li class="${w.id === selectedId ? 'sel' : ''}">
      <button class="grow" data-pick="${w.id}"><b>${esc(w.name)}</b><small>${esc(summary(w))} · 총 ${fmt(totalSeconds(buildSequence(w)))}</small></button>
      <button class="act" data-edit="${w.id}">수정</button>
      <button class="act" data-del="${w.id}">삭제</button>
    </li>`).join('');
}
$('#wk-list').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.pick) {
    selectedId = b.dataset.pick;
    loadWorkout();
    $('#dlg-workouts').close();
  } else if (b.dataset.edit) {
    openEditor(workouts.find((w) => w.id === b.dataset.edit));
  } else if (b.dataset.del) {
    if (workouts.length === 1) { alert('운동은 최소 1개가 있어야 해요.'); return; }
    const w = workouts.find((x) => x.id === b.dataset.del);
    if (!confirm(`'${w.name}' 운동을 삭제할까요?`)) return;
    workouts = workouts.filter((x) => x.id !== w.id);
    store.set('workouts', workouts);
    if (selectedId === w.id) { selectedId = workouts[0].id; loadWorkout(); }
    renderWorkouts();
  }
};
$('#wk-add').onclick = () => openEditor(null);

const ED_FIELDS = [
  { key: 'prepare', label: '준비', hint: '시작 전 카운트다운', color: 'var(--prepare)', time: true },
  { key: 'work', label: '운동', hint: '한 번 운동하는 시간', color: 'var(--work)', time: true, min: 1 },
  { key: 'rest', label: '휴식', hint: '라운드 사이에 쉬는 시간', color: 'var(--rest)', time: true },
  { key: 'rounds', label: '라운드', hint: '1라운드 = 운동 + 휴식', min: 1 },
  { key: 'cycles', label: '사이클', hint: '라운드 묶음을 반복하는 횟수', min: 1 },
  { key: 'cycleRest', label: '사이클 사이 휴식', hint: '사이클이 2 이상일 때만 사용', color: 'var(--cycle)', time: true },
];
let draft = null;
function openEditor(w) {
  draft = w ? { ...w } : { id: '', name: '', prepare: 10, work: 30, rest: 15, rounds: 5, cycles: 1, cycleRest: 0 };
  $('#ed-title').textContent = w ? '운동 수정' : '새 운동';
  $('#ed-name').value = w ? w.name : '';
  renderEditor();
  $('#dlg-editor').showModal();
}
function renderEditor() {
  $('#ed-fields').innerHTML = ED_FIELDS.map((f) => `
    <div class="field">
      <div><b>${f.color ? `<i class="dot" style="background:${f.color}"></i>` : ''}${f.label}</b><small>${f.hint}</small></div>
      <div class="stepper">
        <button data-key="${f.key}" data-d="-1" aria-label="${f.label} 줄이기">−</button>
        <input data-key="${f.key}" inputmode="numeric" aria-label="${f.label}" value="${f.time ? fmtTime(draft[f.key]) : draft[f.key]}">
        <button data-key="${f.key}" data-d="1" aria-label="${f.label} 늘리기">+</button>
      </div>
    </div>`).join('');
  $('#ed-sum').textContent = `총 운동 시간 ${fmtTime(totalSeconds(buildSequence(draft)))}`;
}
function setDraft(key, value) {
  const f = ED_FIELDS.find((x) => x.key === key);
  draft[key] = Math.min(f.time ? 5999 : 99, Math.max(f.min || 0, value));
  renderEditor();
}
$('#ed-fields').onclick = (e) => {
  const b = e.target.closest('button[data-key]');
  if (!b) return;
  const f = ED_FIELDS.find((x) => x.key === b.dataset.key);
  setDraft(f.key, draft[f.key] + Number(b.dataset.d) * (f.time ? 5 : 1));
};
$('#ed-fields').onchange = (e) => {
  const input = e.target.closest('input[data-key]');
  if (!input) return;
  const f = ED_FIELDS.find((x) => x.key === input.dataset.key);
  const v = f.time ? parseTime(input.value) : (/^\d+$/.test(input.value.trim()) ? Number(input.value) : null);
  setDraft(f.key, v == null ? draft[f.key] : v);
};
$('#ed-fields').addEventListener('focusin', (e) => { if (e.target.matches('input')) e.target.select(); });
$('#ed-save').onclick = () => {
  const w = normalizeWorkout({ ...draft, name: $('#ed-name').value });
  if (w.id) workouts = workouts.map((x) => (x.id === w.id ? w : x));
  else { w.id = uid(); workouts.push(w); }
  store.set('workouts', workouts);
  selectedId = w.id;
  loadWorkout();
  renderWorkouts();
  $('#dlg-editor').close();
  $('#dlg-workouts').close();
};

// ---------- 세트 카운터 ----------
const savedSets = store.get('sets', {});
const ST = {
  target: savedSets.target || 5, rest: savedSets.rest || 90,
  phase: 'idle', // idle → working ⇄ resting → finished
  done: 0, sessionStart: 0, setStart: 0, restEndsAt: 0, lastSec: null, total: 0,
};
function setsMain() {
  audio();
  const now = Date.now();
  if (ST.phase === 'idle' || ST.phase === 'finished') {
    Object.assign(ST, { phase: 'working', done: 0, sessionStart: now, setStart: now });
    cue('work', '1세트 시작');
  } else if (ST.phase === 'working') {
    ST.done++;
    if (ST.done >= ST.target) {
      ST.phase = 'finished';
      ST.total = Math.round((now - ST.sessionStart) / 1000);
      cue('done', `${ST.done}세트 완료. 수고하셨습니다`);
      addHistory({ kind: '세트', name: '세트 운동', sec: ST.total, detail: `${ST.done}세트 · 휴식 ${fmtTime(ST.rest)}` });
    } else {
      ST.phase = 'resting';
      ST.restEndsAt = now + ST.rest * 1000;
      ST.lastSec = null;
      cue('rest', '휴식');
    }
  } else if (ST.phase === 'resting') {
    startNextSet();
  }
  syncWake();
  renderSets();
}
function startNextSet() {
  ST.phase = 'working';
  ST.setStart = Date.now();
  cue('work', `${ST.done + 1}세트 시작`);
  renderSets();
}
function tickSets() {
  if (ST.phase === 'resting') {
    const left = ST.restEndsAt - Date.now();
    if (left <= 0) { startNextSet(); return; }
    const sec = Math.ceil(left / 1000);
    if (ST.lastSec !== null && sec !== ST.lastSec && sec <= 3) cue('tick');
    ST.lastSec = sec;
  }
  if (ST.phase === 'working' || ST.phase === 'resting') renderSets();
}
function renderSets() {
  const now = Date.now();
  const p = ST.phase;
  $('#st-stage').dataset.phase = { idle: 'idle', working: 'work', resting: 'rest', finished: 'done' }[p];
  const total = p === 'idle' ? 0 : p === 'finished' ? ST.total : Math.floor((now - ST.sessionStart) / 1000);
  $('#st-total').textContent = fmtTime(total);
  let label, time, next, btn;
  if (p === 'idle') {
    label = '시작 전'; time = fmtTime(0); next = `목표 ${ST.target}세트`; btn = '운동 시작';
  } else if (p === 'working') {
    label = `${ST.done + 1}세트 진행 중`; time = fmtTime(Math.floor((now - ST.setStart) / 1000));
    next = `${ST.done}/${ST.target}세트 완료`; btn = `${ST.done + 1}세트 완료`;
  } else if (p === 'resting') {
    label = '휴식'; time = fmt(Math.ceil((ST.restEndsAt - now) / 1000));
    next = `다음 · ${ST.done + 1}세트 (${ST.done}/${ST.target} 완료)`; btn = '바로 다음 세트 시작';
  } else {
    label = '완료!'; time = fmtTime(ST.total); next = `${ST.done}세트를 마쳤어요`; btn = '새로 시작';
  }
  $('#st-label').textContent = label;
  setTime($('#st-time'), time);
  $('#st-next').textContent = next;
  $('#st-main').textContent = btn;
  $('#st-rest-row').hidden = p !== 'resting';
  $('#st-target').textContent = ST.target;
  $('#st-rest').textContent = fmtTime(ST.rest);
  $('#st-dots').innerHTML = Array.from({ length: ST.target }, (_, i) => `<i class="${i < ST.done ? 'on' : ''}"></i>`).join('');
}
$('#st-main').onclick = setsMain;
$('#st-skip').onclick = startNextSet;
$('#st-plus').onclick = () => { ST.restEndsAt += 10000; renderSets(); };
$('#st-minus').onclick = () => { ST.restEndsAt = Math.max(Date.now() + 1000, ST.restEndsAt - 10000); ST.lastSec = null; renderSets(); };
$('#st-reset').onclick = () => {
  if ((ST.phase === 'working' || ST.phase === 'resting') && !confirm('진행 중인 세트를 처음으로 되돌릴까요?')) return;
  Object.assign(ST, { phase: 'idle', done: 0 });
  syncWake();
  renderSets();
};
$$('[data-st]').forEach((b) => {
  b.onclick = () => {
    const d = Number(b.dataset.d);
    if (b.dataset.st === 'target') ST.target = Math.min(30, Math.max(Math.max(1, ST.done + (ST.phase === 'working' ? 1 : 0)), ST.target + d));
    else ST.rest = Math.min(900, Math.max(10, ST.rest + d));
    store.set('sets', { target: ST.target, rest: ST.rest });
    renderSets();
  };
});

// ---------- 스톱워치 ----------
const SW = { running: false, startAt: 0, acc: 0, laps: [] };
const swElapsed = () => SW.acc + (SW.running ? Date.now() - SW.startAt : 0);
const fmtMs = (ms) => `${fmtTime(Math.floor(ms / 1000))}<small>.${String(Math.floor((ms % 1000) / 10)).padStart(2, '0')}</small>`;
function renderStopwatch() {
  const ms = swElapsed();
  const el = $('#sw-time');
  el.innerHTML = fmtMs(ms);
  el.classList.toggle('long', ms >= 3600000);
  $('#sw-stage').dataset.phase = SW.running ? 'work' : 'idle';
  $('#sw-toggle').textContent = SW.running ? '멈춤' : ms > 0 ? '계속' : '시작';
  $('#sw-lap').textContent = SW.running ? '기록' : '초기화';
  $('#sw-lapcount').textContent = SW.laps.length ? `기록 ${SW.laps.length}개` : '';
}
function renderLaps() {
  $('#sw-laps').innerHTML = SW.laps.map((l, i) => {
    const prev = SW.laps[i + 1] ?? 0;
    return `<li><span>${SW.laps.length - i}번째</span><span>+${fmtMs(l - prev)}</span><span>${fmtMs(l)}</span></li>`;
  }).join('');
}
$('#sw-toggle').onclick = () => {
  if (SW.running) { SW.acc = swElapsed(); SW.running = false; }
  else { SW.startAt = Date.now(); SW.running = true; }
  syncWake();
  renderStopwatch();
};
$('#sw-lap').onclick = () => {
  if (SW.running) SW.laps.unshift(swElapsed());
  else Object.assign(SW, { acc: 0, laps: [] });
  renderLaps();
  renderStopwatch();
};

// ---------- 기록 ----------
function renderHistory() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // 이번 주 월요일
  const week = history.filter((h) => h.at >= d.getTime());
  $('#hs-week').textContent = week.length;
  $('#hs-time').textContent = `${Math.round(week.reduce((s, h) => s + h.sec, 0) / 60)}분`;
  $('#hs-all').textContent = history.length;
  $('#hs-clear').hidden = !history.length;
  $('#hs-list').innerHTML = history.length
    ? history.map((h) => {
      const t = new Date(h.at);
      const when = `${t.getMonth() + 1}월 ${t.getDate()}일 ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`;
      return `<li><div class="grow"><b>${esc(h.name)}</b><small>${when} · ${esc(h.kind)} · ${esc(h.detail || '')}</small></div><span class="tag">${fmtTime(h.sec)}</span></li>`;
    }).join('')
    : '<li class="empty">아직 기록이 없어요.<br>운동을 끝까지 마치면 여기에 자동으로 쌓여요.</li>';
}
$('#hs-clear').onclick = () => {
  if (!confirm('운동 기록을 모두 지울까요? 되돌릴 수 없어요.')) return;
  history = [];
  store.set('history', history);
  renderHistory();
};

// ---------- 설정 ----------
function renderAll() {
  renderInterval();
  renderSets();
  renderStopwatch();
  renderHistory();
}
$$('[data-set]').forEach((el) => {
  const key = el.dataset.set;
  if (el.type === 'checkbox') el.checked = S[key];
  else el.value = S[key];
  el.oninput = () => {
    S[key] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? Number(el.value) : el.value;
    store.set('settings', S);
    if (key === 'keepAwake') syncWake();
    renderAll();
  };
});
$('#set-test').onclick = () => { audio(); cue('work', '운동'); };
$('#btn-settings').onclick = () => $('#dlg-settings').showModal();
$$('[data-close]').forEach((b) => { b.onclick = () => b.closest('dialog').close(); });

// ---------- 탭 ----------
$$('.tabs button').forEach((b) => {
  b.onclick = () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('on', x === b));
    $$('.view').forEach((v) => { v.hidden = v.id !== 'view-' + b.dataset.tab; });
  };
});

// ---------- 시작 ----------
function tickAll() {
  tickInterval();
  tickSets();
  if (SW.running) renderStopwatch();
}
loadWorkout();
renderAll();
renderLaps();
setInterval(tickAll, 50);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
