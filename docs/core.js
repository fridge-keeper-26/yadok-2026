'use strict';
/*
  냉장고 식재료 유통기한 알리미 — 처리 규칙 (docs/core.js)
  규칙의 정본은 docs/data/RULES.md 입니다. 이 파일은 그 규칙을 코드로 옮긴 것입니다.
  화면(docs/app.js)과 자동 검사(tests/check.js)가 이 파일을 함께 씁니다. 규칙이 두 군데 있으면 한쪽만 고쳐지기 때문입니다.
  화면 코드(DOM)는 여기에 없습니다.
  처리 순서(RULES 0번): 읽기 → 이름 정리 → 칸 검사(제외) → 중복 제거 → 보기 조건 → 정렬 → 화면
  Sprint 3: 「잘못된 줄(제외)」과 「지금은 안 보여 주는 것(보기 조건 밖)」을 나눴다. 요약 줄은 N = X + Y + M, M = B + K (RULES 0번, 1번, 5번)
*/

/* ===== 설정: RULES.md와 같은 값 ===== */
const DATA_URL = 'data/fridge-items.csv';
const SOURCE_LABEL = 'fridge-items.csv · 합성 데이터';
const COLUMNS = ['이름', '구입일', '유통기한', '가격', '비고'];
const DAYS_BEFORE = 10; // 기준일보다 10일 넘게 이전이면 「보기 조건 밖」 (RULES 5번)
const DAYS_AFTER = 30;  // 기준일보다 30일 넘게 이후이면 「보기 조건 밖」 (RULES 5번)
const NO_BUY_DATE = '9999-99-99'; // 구입일이 없는 건은 정렬에서 맨 뒤

/* ===== 1. 읽기: CSV 글자를 줄과 칸으로 나눈다 ===== */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  text = text.replace(/^\uFEFF/, ''); // 엑셀용 머리 표시(BOM) 제거
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.some((v) => v.trim() !== '')) rows.push(row); // 빈 줄은 건너뛴다
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  return rows;
}

// 첫 줄(머리글)을 확인하고, 나머지를 한 건씩의 기록으로 바꾼다. line = 파일 안 줄 번호(머리글이 1번째 줄)
function toRecords(rows) {
  const header = (rows[0] || []).map((v) => v.trim());
  if (header.join(',') !== COLUMNS.join(',')) {
    throw new Error('첫 줄이 「' + COLUMNS.join(',') + '」이어야 합니다.');
  }
  return rows.slice(1).map((cells, i) => ({
    orig: i,
    line: i + 2,
    name: cells[0] ?? '',
    buy: cells[1] ?? '',
    exp: cells[2] ?? '',
    price: cells[3] ?? '',
    note: cells[4] ?? '',
  }));
}

/* ===== 2. 이름 정리 (RULES 2번) ===== */
// ① 전각 → 반각 ② 앞뒤 공백 삭제 ③ 연속 공백은 하나로 ④ 영문 소문자
function cleanName(name) {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ===== 날짜 도우미 ===== */
// YYYY-MM-DD 모양이고, 달력에 있는 날짜이면 true
function isValidDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [y, m, d] = text.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function addDays(dateText, days) {
  const [y, m, d] = dateText.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function todayText() {
  const now = new Date();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return now.getFullYear() + '-' + mm + '-' + dd;
}

/* ===== 3~6. 검사(제외) → 중복 제거 → 보기 조건 → 정렬 ===== */
function compareRows(a, b) {
  if (a.exp !== b.exp) return a.exp < b.exp ? -1 : 1;                       // 유통기한이 이른 순
  if (a.clean !== b.clean) return a.clean < b.clean ? -1 : 1;               // 정리한 이름의 글자 코드값 순
  const buyA = a.buyOk ? a.buy : NO_BUY_DATE;
  const buyB = b.buyOk ? b.buy : NO_BUY_DATE;
  if (buyA !== buyB) return buyA < buyB ? -1 : 1;                           // 구입일 이른 순(없는 건은 뒤)
  return a.orig - b.orig;                                                   // 원본 행 순서
}

function processRecords(records, baseDate) {
  const from = addDays(baseDate, -DAYS_BEFORE);
  const to = addDays(baseDate, DAYS_AFTER);
  const excluded = [];
  const duplicates = [];
  const outOfView = []; // 보기 조건 밖(RULES 5번): 잘못된 줄이 아니라 지금은 안 보여 줄 뿐
  const candidates = [];

  // 칸 검사(RULES 4번): 위에서부터 처음 걸린 사유 하나만 기록한다
  for (const r of records) {
    r.clean = cleanName(r.name);
    r.buyOk = isValidDate(r.buy);
    r.buyBadFormat = r.buy !== '' && !r.buyOk; // 구입일 형식 틀림: 제외하지 않고 표시만 붙인다
    if (r.clean === '' || r.exp.trim() === '') {
      excluded.push({ row: r, reason: '필수 빠짐' });
    } else if (!isValidDate(r.exp)) {
      excluded.push({ row: r, reason: '형식 틀림' });
    } else {
      candidates.push(r);
    }
  }

  // 중복 제거(RULES 2번): 정리한 이름과 구입일이 같으면 같은 건. 구입일이 없는 건은 대상이 아니다
  const groups = new Map();
  for (const r of candidates) {
    if (!r.buyOk) continue;
    const key = r.clean + '|' + r.buy;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const dropped = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // 유통기한이 가장 이른 한 건을 남기고, 같으면 원본에서 먼저 나온 행을 남긴다
    group.sort((a, b) => (a.exp === b.exp ? a.orig - b.orig : a.exp < b.exp ? -1 : 1));
    for (const r of group.slice(1)) {
      dropped.add(r);
      duplicates.push({ row: r, keptLine: group[0].line });
    }
  }
  duplicates.sort((a, b) => a.row.orig - b.row.orig);

  // 보기 조건(RULES 5번): 중복에서 남긴 줄에만 적용한다(남긴 줄이 밖이면 그 건은 「보기 조건 밖」)
  const kept = candidates.filter((r) => !dropped.has(r));
  for (const r of kept) {
    if (r.exp < from || r.exp > to) outOfView.push({ row: r, reason: '보기 조건 밖' });
  }
  const outSet = new Set(outOfView.map((o) => o.row));
  const shown = kept.filter((r) => !outSet.has(r)).sort(compareRows);
  outOfView.sort((a, b) => a.row.orig - b.row.orig);
  return { baseDate, from, to, total: records.length, excluded, duplicates, outOfView, shown };
}

/* ===== 요약 줄 ===== */
function summaryText(result) {
  const m = result.outOfView.length + result.shown.length;
  return '원천 ' + result.total + '건 → 제외 ' + result.excluded.length + ' · 중복 ' + result.duplicates.length +
    ' → 냉장고 ' + m + '건(보기 조건 밖 ' + result.outOfView.length + ' · 표시 ' + result.shown.length + ') · 기준일 ' +
    result.baseDate + ' · 출처 ' + SOURCE_LABEL;
}

function checkText(result) {
  const x = result.excluded.length;
  const y = result.duplicates.length;
  const b = result.outOfView.length;
  const k = result.shown.length;
  const m = b + k;
  const ok = result.total === x + y + m;
  return 'N = X + Y + M, M = B + K → ' + result.total + ' = ' + x + ' + ' + y + ' + ' + m + ', ' + m + ' = ' + b + ' + ' + k +
    (ok ? ' (맞음)' : ' (맞지 않음)');
}

/* ===== CSV 내려받기 / 다시 불러와 비교 ===== */
function csvEscape(value) {
  return /[",\r\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

function toCsv(rows) {
  const lines = rows.map((r) => [r.name, r.buy, r.exp, r.price, r.note].map(csvEscape).join(','));
  return COLUMNS.join(',') + '\n' + lines.join('\n') + '\n';
}

function rowKey(r) {
  return [r.name, r.buy, r.exp, r.price, r.note].join('\u0001');
}

/* ===== 자동 검사(node)에서도 쓸 수 있게 내보내기. 브라우저에서는 무시된다 ===== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { COLUMNS, DATA_URL, SOURCE_LABEL, parseCsv, toRecords, cleanName, isValidDate, addDays, processRecords, summaryText, checkText, toCsv, rowKey };
}
