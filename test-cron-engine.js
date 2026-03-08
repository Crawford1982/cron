/**
 * Standalone test for cron engine logic (parser, explainer, getNextRuns).
 * Run: node test-cron-engine.js
 * No DOM required.
 */
const FIELDS = [
  { name: 'Minute',   min: 0, max: 59, labels: null },
  { name: 'Hour',     min: 0, max: 23, labels: null },
  { name: 'Day',      min: 1, max: 31, labels: null },
  { name: 'Month',    min: 1, max: 12, labels: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'] },
  { name: 'Weekday',  min: 0, max: 6,  labels: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'] },
];
const SHORTHANDS = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0', '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
};

function parseField(str, field) {
  const { min, max } = field;
  const vals = new Set();
  if (str === '*') { for (let i = min; i <= max; i++) vals.add(i); return { valid: true, vals, raw: str }; }
  const parts = str.split(',');
  for (const part of parts) {
    if (part.includes('/')) {
      const [range, step] = part.split('/');
      const s = parseInt(step);
      if (isNaN(s) || s < 1) return { valid: false };
      let lo = min, hi = max;
      if (range !== '*') {
        if (range.includes('-')) { [lo, hi] = range.split('-').map(Number); }
        else { lo = parseInt(range); hi = max; }
      }
      if (isNaN(lo) || isNaN(hi) || lo < min || hi > max) return { valid: false };
      for (let i = lo; i <= hi; i += s) vals.add(i);
    } else if (part.includes('-')) {
      const [lo, hi] = part.split('-').map(Number);
      if (isNaN(lo) || isNaN(hi) || lo < min || hi > max || lo > hi) return { valid: false };
      for (let i = lo; i <= hi; i++) vals.add(i);
    } else {
      const v = parseInt(part);
      if (isNaN(v) || v < min || v > max) return { valid: false };
      vals.add(v);
    }
  }
  return { valid: true, vals, raw: str };
}

function parseCron(expr) {
  expr = expr.trim();
  if (SHORTHANDS[expr.toLowerCase()]) expr = SHORTHANDS[expr.toLowerCase()];
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return null;
  const parsed = parts.map((p, i) => parseField(p, FIELDS[i]));
  if (parsed.some(p => !p.valid)) return null;
  return parsed;
}

function fmtHour(h) {
  if (h === 0) return '12am (midnight)';
  if (h === 12) return '12pm (noon)';
  return h < 12 ? `${h}am` : `${h - 12}pm`;
}
function joinList(arr) {
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return arr.join(' and ');
  return arr.slice(0, -1).join(', ') + ', and ' + arr[arr.length - 1];
}
function describeField(raw, field, idx) {
  if (raw === '*') return null;
  if (raw.startsWith('*/')) return `every ${raw.slice(2)} ${field.name.toLowerCase()}s`;
  if (/^\d+-\d+$/.test(raw)) {
    const [lo, hi] = raw.split('-').map(Number);
    if (idx === 4 && field.labels) return `${field.labels[lo]} through ${field.labels[hi]}`;
    if (idx === 3 && field.labels) return `${field.labels[lo-1]} through ${field.labels[hi-1]}`;
    if (idx === 1) return `between ${fmtHour(lo)} and ${fmtHour(hi)}`;
    return `${field.name.toLowerCase()} ${lo} to ${hi}`;
  }
  if (raw.includes(',')) {
    const vals = raw.split(',').map(Number);
    if (idx === 4 && field.labels) return `on ${joinList(vals.map(v => field.labels[v]))}`;
    if (idx === 3 && field.labels) return `in ${joinList(vals.map(v => field.labels[v-1]))}`;
    if (idx === 1) return `at ${joinList(vals.map(fmtHour))}`;
    return `at minutes ${joinList(vals.map(String))}`;
  }
  const v = parseInt(raw);
  if (idx === 1) return `at ${fmtHour(v)}`;
  if (idx === 0) return `at minute ${v === 0 ? 'zero (top of the hour)' : v}`;
  if (idx === 2) return `on day ${v} of the month`;
  if (idx === 3 && field.labels) return `in ${field.labels[v-1]}`;
  if (idx === 4 && field.labels) return `on ${field.labels[v]}`;
  return `${field.name.toLowerCase()} ${v}`;
}

function buildExplanation(expr) {
  expr = expr.trim();
  const low = expr.toLowerCase();
  if (SHORTHANDS[low]) return `"${expr}" is a shorthand for "${SHORTHANDS[low]}" — ${buildExplanation(SHORTHANDS[low])}`;
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hr, dom, mon, dow] = parts;
  const descs = [min, hr, dom, mon, dow].map((p, i) => describeField(p, FIELDS[i], i));
  let s = 'Runs ';
  if (min === '*' && hr === '*') s += 'every minute';
  else if (min.startsWith('*/')) s += descs[0];
  else if (hr === '*') s += `${descs[0] || 'every minute'}, every hour`;
  else { s += descs[1] || ''; if (descs[0] && !descs[0].includes('zero')) s += ` ${descs[0]}`; }
  if (dom !== '*') s += `, ${descs[2]}`;
  if (mon !== '*') s += `, ${descs[3]}`;
  if (dow !== '*') s += `, ${descs[4]}`;
  if (dom === '*' && mon === '*' && dow === '*' && hr !== '*' && !hr.startsWith('*/')) s += ', every day';
  return s;
}

function getNextRuns(expr, count = 10) {
  const parsed = parseCron(expr);
  if (!parsed) return [];
  const [minF, hrF, domF, monF, dowF] = parsed;
  const runs = [];
  const now = new Date();
  let d = new Date(now);
  d.setSeconds(0, 0);
  d.setMinutes(d.getMinutes() + 1);
  let iterations = 0;
  while (runs.length < count && iterations < 100000) {
    iterations++;
    if (!monF.vals.has(d.getMonth() + 1)) { d.setMonth(d.getMonth() + 1); d.setDate(1); d.setHours(0); d.setMinutes(0); continue; }
    if (!domF.vals.has(d.getDate()))       { d.setDate(d.getDate() + 1); d.setHours(0); d.setMinutes(0); continue; }
    if (!dowF.vals.has(d.getDay()))        { d.setDate(d.getDate() + 1); d.setHours(0); d.setMinutes(0); continue; }
    if (!hrF.vals.has(d.getHours()))       { d.setHours(d.getHours() + 1); d.setMinutes(0); continue; }
    if (!minF.vals.has(d.getMinutes()))    { d.setMinutes(d.getMinutes() + 1); continue; }
    runs.push(new Date(d));
    d.setMinutes(d.getMinutes() + 1);
  }
  return runs;
}

// --- Tests ---
let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; return; }
  failed++;
  console.error('FAIL:', msg);
}
function eq(a, b, msg) {
  const same = a === b || (typeof a === 'string' && typeof b === 'string' && a.trim() === b.trim());
  if (same) { passed++; return; }
  failed++;
  console.error('FAIL:', msg, '| got:', a, '| expected:', b);
}

// Parser
ok(parseCron('* * * * *') !== null, 'parse * * * * *');
ok(parseCron('*/5 * * * *') !== null, 'parse */5 * * * *');
ok(parseCron('0 9 * * 1-5') !== null, 'parse 0 9 * * 1-5');
ok(parseCron('0 0 1 * *') !== null, 'parse 0 0 1 * *');
ok(parseCron('@daily') !== null, 'parse @daily');
ok(parseCron('0 0 1 1 *') !== null, 'parse 0 0 1 1 *');
ok(parseCron('') === null, 'parse empty');
ok(parseCron('1 2 3') === null, 'parse too few fields');
ok(parseCron('60 * * * *') === null, 'parse invalid minute 60');
ok(parseCron('* 25 * * *') === null, 'parse invalid hour 25');
ok(parseCron('0 9 * * 1-5').length === 5, 'parsed has 5 fields');

// Explainer
eq(buildExplanation('*/5 * * * *').indexOf('every 5 minutes') >= 0, true, '*/5 explains every 5 minutes');
eq(buildExplanation('0 9 * * 1-5').indexOf('9am') >= 0 && buildExplanation('0 9 * * 1-5').indexOf('Mon') >= 0, true, '0 9 * * 1-5 explains weekdays 9am');
ok(buildExplanation('@daily').indexOf('@daily') >= 0 && buildExplanation('@daily').indexOf('0 0 * * *') >= 0, '@daily expands to 0 0 * * *');
ok(buildExplanation('* * * * *').indexOf('every minute') >= 0, '* * * * * = every minute');
ok(buildExplanation('0 0 1 * *').indexOf('1') >= 0 && buildExplanation('0 0 1 * *').indexOf('month') >= 0, 'first of month');

// Next runs
const runs5 = getNextRuns('*/5 * * * *', 3);
ok(runs5.length === 3, 'getNextRuns returns requested count');
ok(runs5.every(d => d.getMinutes() % 5 === 0), '*/5 runs at 0,5,10,15...');
const runsHour = getNextRuns('0 * * * *', 2);
ok(runsHour.length === 2 && runsHour.every(d => d.getMinutes() === 0), '0 * * * * runs at minute 0');
const runsInvalid = getNextRuns('bad', 5);
ok(runsInvalid.length === 0, 'invalid expr returns []');

// updatePageTitle logic (short description)
const expl = buildExplanation('*/5 * * * *');
const short = expl.replace(/^Runs\s+/i, '').slice(0, 52);
ok(short.length <= 52 && short.indexOf('5') >= 0, 'title short description derived from explanation');

// Edge: 31st of month (Feb has no 31)
const runs31 = getNextRuns('0 0 31 * *', 3);
ok(runs31.length >= 1, '31 * * runs return at least one (Jan/Mar/etc)');
ok(runs31.every(d => d.getDate() === 31), 'all runs are on 31st');

// buildExplanation never returns null for valid 5-field
ok(buildExplanation('0 12 * * 6') !== null && buildExplanation('0 12 * * 6').indexOf('12') >= 0, 'Saturday noon has explanation');

console.log('\nTotal:', passed + failed, '| Passed:', passed, '| Failed:', failed);
process.exit(failed > 0 ? 1 : 0);
