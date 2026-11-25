'use strict';
/*
  자동 검사 — tests/cases.md의 검사표를 한 줄씩 돌려 「기대 처리」와 하나라도 다르면 실패(종료 코드 1)로 끝낸다.
  화면(docs/app.js)과 같은 처리 코드(docs/core.js)를 쓴다. 규칙이 두 군데 있으면 한쪽만 고쳐지기 때문이다.
  사용: node tests/check.js [--cases 파일] [--json 결과파일]
  결과: 「검사표 N줄 중 통과 n」, 틀린 줄은 기대·실제를 보여 준다.
*/
const fs = require('fs');
const path = require('path');
const core = require(path.join(__dirname, '..', 'docs', 'core.js'));

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const casesPath = opt('--cases') || path.join(__dirname, 'cases.md');
const jsonPath = opt('--json');

const WORDS = ['보기 조건 밖', '표시', '중복', '제외'];

/* ===== 검사표 읽기 ===== */
function parseCases(text) {
  const m = text.match(/기준일:\s*(\d{4}-\d{2}-\d{2})/);
  if (!m) throw new Error('검사표에 「기준일: YYYY-MM-DD」가 없습니다.');
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const mm = line.match(/^\|\s*(\d+)\s*\|(.*)\|\s*$/);
    if (!mm) continue;
    const parts = line.split('|').map((c) => c.trim());   // ['', 번호, 입력, 기대 처리, 이유, '']
    const cells = parts.slice(2, parts.length - 1);       // [입력, 기대 처리, 이유]
    const raw = cells[0] || '';
    const pair = raw.match(/\((\d+)번과 한 쌍\)/);
    const input = raw.replace(/\s*\([^()]*\)\s*$/, '').trim();
    rows.push({
      no: Number(mm[1]),
      lines: input === '' && raw === '' ? [] : input.split(/\s+\/\s+/),
      pairWith: pair ? Number(pair[1]) : null,
      expected: cells[1] || '',
      reason: cells[2] || '',
    });
  }
  return { baseDate: m[1], rows };
}

/* ===== 한 줄 판정 ===== */
function labelOf(result, line) {
  const ex = result.excluded.find((e) => e.row.line === line);
  if (ex) return { word: '제외', detail: ex.reason };
  const du = result.duplicates.find((d) => d.row.line === line);
  if (du) return { word: '중복', detail: '남긴 줄 ' + du.keptLine };
  const ov = result.outOfView.find((o) => o.row.line === line);
  if (ov) return { word: '보기 조건 밖', detail: '' };
  if (result.shown.some((s) => s.line === line)) return { word: '표시', detail: '' };
  return { word: '알 수 없음', detail: '' };
}

function runLines(lines, baseDate) {
  const csv = core.COLUMNS.join(',') + '\n' + lines.join('\n') + '\n';
  return core.processRecords(core.toRecords(core.parseCsv(csv)), baseDate);
}

function parseExpected(text) {
  const word = WORDS.find((w) => text.startsWith(w)) || WORDS.find((w) => text.includes(w)) || null;
  const count = (text.match(/(\d+)\s*건/) || [])[1];
  const order = (text.match(/순서\s*(.+)$/) || [])[1];
  return { word, count: count ? Number(count) : null, order: order ? order.split('→').map((s) => s.trim()) : null };
}

/* ===== 전체 실행 ===== */
const { baseDate, rows } = parseCases(fs.readFileSync(casesPath, 'utf8'));
const byNo = new Map(rows.map((r) => [r.no, r]));
const failures = [];
let passed = 0;

for (const row of rows) {
  const exp = parseExpected(row.expected);
  if (!exp.word) { failures.push({ no: row.no, expected: row.expected, actual: '기대 처리를 읽지 못함', input: row.lines.join(' / ') }); continue; }
  let lines = row.lines;
  let target = [];            // 이 행의 줄이 실행 결과에서 몇 번째 줄인지(파일 줄 번호)
  let prefix = 0;
  if (row.pairWith) {          // 「N번과 한 쌍」: N번 입력을 앞에 두고 같이 돌린다
    const head = byNo.get(row.pairWith);
    lines = [...head.lines, ...row.lines];
    prefix = head.lines.length;
  }
  const result = runLines(lines, baseDate);
  for (let i = 0; i < row.lines.length; i++) target.push(prefix + i + 2);   // 머리글이 1번째 줄
  const labels = target.map((n) => labelOf(result, n));
  const words = [...new Set(labels.map((l) => l.word))];
  const actualWord = words.length === 1 ? words[0] : '혼합(' + words.join('·') + ')';
  let ok = actualWord === exp.word;
  let actualText = labels.length === 1 && labels[0].detail ? actualWord + '(' + labels[0].detail + ')' : actualWord;
  if (ok && exp.count !== null) { const n = labels.filter((l) => l.word === exp.word).length; if (n !== exp.count) { ok = false; actualText += ' ' + n + '건'; } }
  if (ok && exp.order) {
    const names = result.shown.map((s) => s.name);
    const want = exp.order.map((n) => core.cleanName(n));
    const got = names.map((n) => core.cleanName(n));
    if (want.join('>') !== got.join('>')) { ok = false; actualText += ' 순서 ' + names.join(' → '); }
  }
  if (ok) passed++;
  else failures.push({ no: row.no, expected: row.expected, actual: actualText, input: row.lines.join(' / ') });
}

const total = rows.length;
console.log('검사표 (기준일 ' + baseDate + ') ' + total + '줄 중 통과 ' + passed);
for (const f of failures) console.log('실패 ' + f.no + '번 줄 · 기대 ' + f.expected + ' · 실제 ' + f.actual + '\n  입력: ' + f.input);
if (jsonPath) {
  // 화면에 보여 줄 값: 마지막 갱신 시각(한국 시각), 검사 결과, 판(커밋 앞 7자리, Actions에서만 값이 있음)
  const updated = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 16);
  const commit = (process.env.GITHUB_SHA || 'local').slice(0, 7);
  fs.writeFileSync(jsonPath, JSON.stringify({ updated, total, passed, commit, baseDate, failed: failures.map((f) => f.no) }, null, 2) + '\n');
}
process.exit(total > 0 && failures.length === 0 ? 0 : 1);
