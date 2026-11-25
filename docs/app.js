'use strict';
/*
  냉장고 식재료 유통기한 알리미 — 화면 (docs/app.js)
  처리 규칙은 docs/core.js에 있고, 이 파일은 그 결과를 화면에 그리고 버튼을 연결한다.
  (index.html에서 core.js를 먼저 불러온다.)
*/

/* ===== 화면 ===== */
const state = { records: [], result: null };

function $(id) { return document.getElementById(id); }

function cell(tr, text) {
  const td = document.createElement('td');
  td.textContent = text;
  tr.appendChild(td);
  return td;
}

function fillTable(table, head, rows) {
  table.replaceChildren();
  const thead = document.createElement('thead');
  const hr = document.createElement('tr');
  for (const h of head) {
    const th = document.createElement('th');
    th.textContent = h;
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  const tbody = document.createElement('tbody');
  for (const values of rows) {
    const tr = document.createElement('tr');
    for (const v of values) cell(tr, v);
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
}

function render() {
  const baseDate = $('baseDate').value;
  if (!isValidDate(baseDate)) {
    $('summary').textContent = '기준일을 YYYY-MM-DD 형식의 날짜로 지정하세요.';
    $('check').textContent = '';
    return;
  }
  const result = processRecords(state.records, baseDate);
  state.result = result;
  $('summary').textContent = summaryText(result);
  $('check').textContent = checkText(result);
  $('range').textContent = '보기 조건: 유통기한 ' + result.from + ' ~ ' + result.to + ' (이 밖은 「보기 조건 밖」으로 접어 둠)';

  fillTable($('shown'), ['순서', '줄', '이름', '구입일', '유통기한', '가격', '비고', '표시'],
    result.shown.map((r, i) => [String(i + 1), String(r.line), r.name, r.buy, r.exp, r.price, r.note,
      r.buyBadFormat ? '구입일 형식 틀림' : '']));
  fillTable($('excluded'), ['줄', '이름', '이유', '구입일', '유통기한'],
    result.excluded.map((e) => [String(e.row.line), e.row.name, e.reason, e.row.buy, e.row.exp]));
  fillTable($('duplicates'), ['줄', '이름', '이유', '남긴 줄'],
    result.duplicates.map((d) => [String(d.row.line), d.row.name, '중복', String(d.keptLine)]));
  fillTable($('outOfView'), ['줄', '이름', '이유', '구입일', '유통기한'],
    result.outOfView.map((o) => [String(o.row.line), o.row.name, o.reason, o.row.buy, o.row.exp]));
  $('excludedCount').textContent = String(result.excluded.length);
  $('duplicatesCount').textContent = String(result.duplicates.length);
  $('outOfViewCount').textContent = String(result.outOfView.length);
  $('verify').textContent = '';
}

function downloadResult() {
  if (!state.result) return;
  const blob = new Blob(['\uFEFF' + toCsv(state.result.shown)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'fridge-items-result-' + state.result.baseDate + '.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// 내려받은 CSV를 다시 불러와 지금 화면과 K건·순서가 같은지 본다
async function checkLoadedFile(file) {
  const box = $('verify');
  try {
    const text = await file.text();
    const records = toRecords(parseCsv(text));
    const shown = state.result.shown;
    // 파일에 적힌 순서 그대로(다시 정렬하지 않고) 지금 화면의 건수·순서와 같은지 비교한다
    const sameOrder = records.length === shown.length && records.every((r, i) => rowKey(r) === rowKey(shown[i]));
    // 같은 규칙·같은 기준일로 다시 처리해도 제외·중복이 없고 그대로 남는지도 본다
    const loaded = processRecords(records, state.result.baseDate);
    box.textContent = '불러온 파일 ' + records.length + '건 / 파일 순서와 지금 화면 비교: ' +
      (sameOrder ? '같은 ' + shown.length + '건 · 같은 순서 (맞음)' : '다름 (파일 ' + records.length + '건, 화면 ' + shown.length + '건)') +
      ' / 같은 규칙으로 다시 처리: ' + summaryText(loaded);
  } catch (err) {
    box.textContent = '불러오지 못했습니다: ' + err.message;
  }
}

// 예약·배포 때 만들어지는 status.json을 읽어 「마지막 갱신 · 검사 n/N 통과 · 판」을 보여 준다
async function showStatus() {
  const box = $('status');
  try {
    const res = await fetch('status.json?t=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) throw new Error(String(res.status));
    const s = await res.json();
    box.textContent = '마지막 갱신 ' + s.updated + ' · 검사 ' + s.passed + '/' + s.total + ' 통과 · 판 ' + s.commit;
  } catch (err) {
    box.textContent = '갱신 정보 없음(배포 전이거나 로컬에서 연 화면입니다)';
  }
}

async function start() {
  showStatus();
  $('baseDate').value = todayText(); // 지정하지 않으면 여는 날짜(오늘)
  $('baseDate').addEventListener('change', render);
  $('download').addEventListener('click', downloadResult);
  $('upload').addEventListener('change', (e) => {
    if (e.target.files[0] && state.result) checkLoadedFile(e.target.files[0]);
  });
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error('자료 파일을 읽지 못했습니다(' + res.status + ')');
    state.records = toRecords(parseCsv(await res.text()));
    render();
  } catch (err) {
    $('summary').textContent = '오류: ' + err.message;
  }
}

start();
