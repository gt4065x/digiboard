// 셋고 타이머 - 화면과 무관한 순수 계산 로직

export const PHASE_LABEL = {
  prepare: '준비',
  work: '운동',
  rest: '휴식',
  cycleRest: '사이클 휴식',
};

const int = (v, min, max) => Math.min(max, Math.max(min, Math.round(Number(v) || 0)));

// 저장된 값이 깨져 있어도 안전하게 쓸 수 있도록 정리
export function normalizeWorkout(w = {}) {
  return {
    id: w.id || '',
    name: String(w.name || '').trim() || '이름 없는 운동',
    prepare: int(w.prepare, 0, 5999),
    work: int(w.work, 1, 5999),
    rest: int(w.rest, 0, 5999),
    rounds: int(w.rounds, 1, 99),
    cycles: int(w.cycles, 1, 99),
    cycleRest: int(w.cycleRest, 0, 5999),
  };
}

// 운동 설정을 실제로 진행될 구간 목록으로 펼친다.
// 규칙: 마지막 운동 뒤에는 휴식을 넣지 않는다.
//       사이클 사이에는 '사이클 휴식'을 쓰고, 0초면 일반 휴식으로 대신한다.
export function buildSequence(workout) {
  const w = normalizeWorkout(workout);
  const seq = [];
  if (w.prepare > 0) seq.push({ type: 'prepare', dur: w.prepare, round: 1, cycle: 1 });
  for (let c = 1; c <= w.cycles; c++) {
    for (let r = 1; r <= w.rounds; r++) {
      seq.push({ type: 'work', dur: w.work, round: r, cycle: c });
      const lastRound = r === w.rounds;
      const lastCycle = c === w.cycles;
      if (!lastRound) {
        if (w.rest > 0) seq.push({ type: 'rest', dur: w.rest, round: r, cycle: c });
      } else if (!lastCycle) {
        if (w.cycleRest > 0) seq.push({ type: 'cycleRest', dur: w.cycleRest, round: r, cycle: c });
        else if (w.rest > 0) seq.push({ type: 'rest', dur: w.rest, round: r, cycle: c });
      }
    }
  }
  return seq;
}

export function totalSeconds(seq) {
  return seq.reduce((sum, p) => sum + p.dur, 0);
}

// format: 'mmss' → 01:30 / 'sec' → 90
export function fmtTime(sec, format = 'mmss') {
  sec = Math.max(0, Math.round(sec));
  if (format === 'sec') return String(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// "1:30" → 90, "130" → 90, "45" → 45. 읽을 수 없으면 null
export function parseTime(text) {
  const t = String(text ?? '').trim();
  if (!t) return null;
  if (t.includes(':')) {
    const [m, s] = t.split(':');
    if (!/^\d*$/.test(m) || !/^\d*$/.test(s)) return null;
    return (Number(m) || 0) * 60 + (Number(s) || 0);
  }
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return t.length <= 2 ? n : Math.floor(n / 100) * 60 + (n % 100);
}
