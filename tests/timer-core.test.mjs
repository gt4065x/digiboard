import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSequence, totalSeconds, fmtTime, parseTime } from '../public/static/timer/core.js';

const types = (seq) => seq.map((p) => p.type).join(',');

test('타바타: 준비 + 8라운드, 마지막 휴식 없음', () => {
  const seq = buildSequence({ prepare: 10, work: 20, rest: 10, rounds: 8, cycles: 1, cycleRest: 0 });
  assert.equal(seq.length, 1 + 8 + 7);
  assert.equal(seq.at(-1).type, 'work');
  assert.equal(totalSeconds(seq), 10 + 8 * 20 + 7 * 10);
});

test('사이클 사이에는 사이클 휴식을 사용', () => {
  const seq = buildSequence({ prepare: 0, work: 30, rest: 10, rounds: 2, cycles: 2, cycleRest: 60 });
  assert.equal(types(seq), 'work,rest,work,cycleRest,work,rest,work');
  assert.deepEqual([seq[4].round, seq[4].cycle], [1, 2]);
});

test('사이클 휴식이 0이면 일반 휴식으로 대신', () => {
  const seq = buildSequence({ work: 30, rest: 10, rounds: 1, cycles: 2, cycleRest: 0 });
  assert.equal(types(seq), 'work,rest,work');
});

test('1라운드 1사이클은 운동만', () => {
  assert.equal(types(buildSequence({ prepare: 4, work: 120, rest: 20, rounds: 1, cycles: 1, cycleRest: 20 })), 'prepare,work');
});

test('깨진 값도 안전하게 처리', () => {
  const seq = buildSequence({ work: 'x', rounds: -3, cycles: null });
  assert.equal(types(seq), 'work');
  assert.equal(seq[0].dur, 1);
});

test('시간 표시', () => {
  assert.equal(fmtTime(96), '01:36');
  assert.equal(fmtTime(3725), '1:02:05');
  assert.equal(fmtTime(96, 'sec'), '96');
});

test('시간 입력 해석', () => {
  assert.equal(parseTime('1:30'), 90);
  assert.equal(parseTime('130'), 90);
  assert.equal(parseTime('45'), 45);
  assert.equal(parseTime(':20'), 20);
  assert.equal(parseTime('abc'), null);
  assert.equal(parseTime(''), null);
});
