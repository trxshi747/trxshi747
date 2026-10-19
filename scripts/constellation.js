// Generates an animated "constellation" SVG from a GitHub contribution calendar.
// Usage: node scripts/constellation.js <output.svg>
// Env:   GH_USER  (default: trxshi747)   GH_TOKEN (optional, enables the GraphQL API)
const fs = require("fs");

const USER = process.env.GH_USER || "trxshi747";
const TOKEN = process.env.GH_TOKEN || "";
const OUT = process.argv[2] || "constellation.svg";

// ---------------------------------------------------------------- data
async function fromGraphQL() {
  const query = `query($u:String!){user(login:$u){contributionsCollection{contributionCalendar{weeks{contributionDays{date contributionCount weekday}}}}}}`;
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json", "User-Agent": "constellation" },
    body: JSON.stringify({ query, variables: { u: USER } }),
  });
  const json = await res.json();
  const weeks = json?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks) throw new Error("GraphQL returned no calendar: " + JSON.stringify(json).slice(0, 200));
  const days = [];
  weeks.forEach((w, wi) => w.contributionDays.forEach(d => days.push({ date: d.date, weekday: d.weekday, week: wi, count: d.contributionCount })));
  return days;
}

async function fromHtml() {
  const res = await fetch(`https://github.com/users/${USER}/contributions`, { headers: { "X-Requested-With": "XMLHttpRequest", "User-Agent": "constellation" } });
  const html = await res.text();
  const tips = {};
  for (const m of html.matchAll(/<tool-tip[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
    const n = m[2].match(/^(\d+) contribution/);
    tips[m[1]] = n ? parseInt(n[1], 10) : 0;
  }
  const days = [];
  for (const m of html.matchAll(/<td\b[^>]*>/g)) {
    const tag = m[0];
    const date = (tag.match(/data-date="([^"]+)"/) || [])[1];
    const id = (tag.match(/\bid="(contribution-day-component-(\d+)-(\d+))"/) || []);
    if (!date || !id[1]) continue;
    days.push({ date, weekday: parseInt(id[2], 10), week: parseInt(id[3], 10), count: tips[id[1]] ?? 0 });
  }
  if (!days.length) throw new Error("No days parsed from the contributions page");
  return days;
}

// ---------------------------------------------------------------- helpers
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
let seed = 11;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const f = (n, d = 1) => Number(n).toFixed(d);
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,'Courier New',monospace";

async function main() {
  let days;
  try { days = TOKEN ? await fromGraphQL() : await fromHtml(); }
  catch (e) { console.warn("primary source failed:", e.message); days = await fromHtml(); }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const W = 1000, H = 270;
  const X0 = 55, X1 = 945, Y0 = 62, Y1 = 214;
  const weeks = Math.max(...days.map(d => d.week)) + 1;
  const maxCount = Math.max(1, ...days.map(d => d.count));
  const total = days.reduce((s, d) => s + d.count, 0);
  const active = days.filter(d => d.count > 0);

  // positions (jittered grid so the stars look hand placed)
  for (const d of days) {
    d.x = X0 + (d.week / Math.max(1, weeks - 1)) * (X1 - X0) + (hash(d.date + "x") - 0.5) * 11;
    d.y = Y0 + (d.weekday / 6) * (Y1 - Y0) + (hash(d.date + "y") - 0.5) * 15;
  }

  // streak runs (consecutive active days, gap of at most 3 days) -> constellation lines
  const runs = [];
  let run = [];
  for (const d of active) {
    const last = run[run.length - 1];
    if (last && (new Date(d.date) - new Date(last.date)) / 86400000 > 3) { runs.push(run); run = []; }
    run.push(d);
  }
  if (run.length) runs.push(run);
  let longest = 0, streak = 0, prev = null;
  for (const d of active) {
    const gap = prev ? (new Date(d.date) - new Date(prev.date)) / 86400000 : 0;
    streak = prev && gap === 1 ? streak + 1 : 1; longest = Math.max(longest, streak); prev = d;
  }

  // ---------------- layers
  let dust = "";
  for (let i = 0; i < 150; i++) {
    const x = rnd() * W, y = rnd() * H, r = 0.3 + rnd() * 0.8, dur = 3 + rnd() * 6, begin = -rnd() * 8;
    dust += `<circle cx="${f(x)}" cy="${f(y)}" r="${f(r, 2)}" fill="#e9d5ff"><animate attributeName="opacity" values="0.08;0.5;0.08" dur="${f(dur)}s" begin="${f(begin)}s" repeatCount="indefinite"/></circle>`;
  }

  let lines = "";
  runs.filter(r => r.length > 1).forEach(r => {
    const pts = r.map(d => `${f(d.x)},${f(d.y)}`).join(" ");
    lines += `<polyline points="${pts}" fill="none" stroke="url(#line)" stroke-width="0.9" stroke-linejoin="round" opacity="0.55" stroke-dasharray="3 5"><animate attributeName="stroke-dashoffset" from="0" to="-32" dur="4s" repeatCount="indefinite"/></polyline>`;
  });

  let pulses = "";
  runs.filter(r => r.length >= 3).sort((a, b) => b.length - a.length).slice(0, 5).forEach((r, i) => {
    const path = "M" + r.map(d => `${f(d.x)} ${f(d.y)}`).join(" L");
    const dur = 4 + r.length * 0.9;
    pulses += `<circle r="2.4" fill="#ffffff" filter="url(#glow)"><animateMotion path="${path}" dur="${f(dur)}s" begin="${f(-i * 1.7)}s" repeatCount="indefinite"/></circle>`;
  });

  let stars = "";
  for (const d of active) {
    const t = Math.min(1, d.count / Math.max(5, maxCount * 0.55));
    const r = 1.4 + t * 2.8;
    const core = t > 0.6 ? "#ffffff" : t > 0.25 ? "#f0abfc" : "#c4b5fd";
    const halo = t > 0.6 ? "#e11bff" : t > 0.25 ? "#d946ef" : "#8b5cf6";
    const dur = 2.2 + hash(d.date + "d") * 4, begin = -hash(d.date + "b") * 6;
    let s = `<g><animate attributeName="opacity" values="${f(0.55 + t * 0.2, 2)};1;${f(0.55 + t * 0.2, 2)}" dur="${f(dur)}s" begin="${f(begin)}s" repeatCount="indefinite"/>`;
    s += `<circle cx="${f(d.x)}" cy="${f(d.y)}" r="${f(r * 3.4)}" fill="${halo}" opacity="${f(0.16 + t * 0.2, 2)}" filter="url(#soft)"/>`;
    s += `<circle cx="${f(d.x)}" cy="${f(d.y)}" r="${f(r)}" fill="${core}"/>`;
    if (t > 0.45) {
      const L = r * 4.2;
      s += `<path d="M${f(d.x - L)} ${f(d.y)} H${f(d.x + L)} M${f(d.x)} ${f(d.y - L)} V${f(d.y + L)}" stroke="${core}" stroke-width="0.7" opacity="0.7"/>`;
    }
    s += `</g>`;
    stars += s;
  }

  let shooting = "";
  for (let i = 0; i < 4; i++) {
    const sx = 250 + rnd() * 700, sy = 8 + rnd() * 60, dx = -(220 + rnd() * 120), dy = 90 + rnd() * 50;
    const dur = 9 + rnd() * 6, begin = -rnd() * 12;
    shooting += `<g opacity="0"><line x1="0" y1="0" x2="62" y2="-26" stroke="url(#tail)" stroke-width="1.6" stroke-linecap="round"/><circle r="1.8" fill="#fff"/>`
      + `<animateTransform attributeName="transform" type="translate" values="${f(sx)} ${f(sy)};${f(sx + dx)} ${f(sy + dy)};${f(sx + dx)} ${f(sy + dy)}" keyTimes="0;0.1;1" dur="${f(dur)}s" begin="${f(begin)}s" repeatCount="indefinite"/>`
      + `<animate attributeName="opacity" values="0;1;0;0" keyTimes="0;0.02;0.1;1" dur="${f(dur)}s" begin="${f(begin)}s" repeatCount="indefinite"/></g>`;
  }

  // month labels
  let months = "";
  const names = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  let lastMonth = -1;
  for (const d of days.filter(x => x.weekday === 0)) {
    const m = parseInt(d.date.slice(5, 7), 10) - 1;
    if (m !== lastMonth) { lastMonth = m; const x = X0 + (d.week / Math.max(1, weeks - 1)) * (X1 - X0); months += `<text x="${f(x)}" y="40" font-size="9" letter-spacing="2" fill="#8b7bb8">${names[m]}</text>`; }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Contribution constellation of ${USER}">
<defs>
  <radialGradient id="bg" cx="50%" cy="40%" r="80%"><stop offset="0%" stop-color="#12062a"/><stop offset="60%" stop-color="#07020f"/><stop offset="100%" stop-color="#030108"/></radialGradient>
  <radialGradient id="vig" cx="50%" cy="50%" r="72%"><stop offset="60%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.8"/></radialGradient>
  <linearGradient id="line" x1="0" x2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset="1" stop-color="#e879f9"/></linearGradient>
  <linearGradient id="tail" x1="0" x2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#e11bff" stop-opacity="0"/></linearGradient>
  <filter id="neb" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
  <filter id="soft" x="-200%" y="-200%" width="500%" height="500%"><feGaussianBlur stdDeviation="2.2"/></filter>
  <filter id="glow" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
  <clipPath id="clip"><rect width="${W}" height="${H}" rx="16"/></clipPath>
</defs>
<g clip-path="url(#clip)">
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<g filter="url(#neb)">
  <ellipse cx="260" cy="120" rx="220" ry="60" fill="#5b21b6" opacity="0.45"><animate attributeName="cx" values="260;460;260" dur="22s" repeatCount="indefinite"/></ellipse>
  <ellipse cx="760" cy="150" rx="230" ry="70" fill="#a21caf" opacity="0.3"><animate attributeName="cx" values="760;560;760" dur="26s" repeatCount="indefinite"/></ellipse>
  <ellipse cx="500" cy="230" rx="300" ry="40" fill="#3b0f8c" opacity="0.35"/>
</g>
${dust}
${months}
${lines}
${stars}
${pulses}
${shooting}
<rect width="${W}" height="${H}" fill="url(#vig)"/>
<g font-family="${MONO}" font-size="10" letter-spacing="2">
  <text x="30" y="${H - 18}" fill="#c4b5fd">${total} CONTRIBUTIONS  /  ${active.length} ACTIVE DAYS  /  LONGEST STREAK ${longest}</text>
  <text x="${W - 30}" y="${H - 18}" text-anchor="end" fill="#e879f9" opacity="0.85">EVERY STAR IS A DAY SHIPPED<animate attributeName="opacity" values="0.4;0.95;0.4" dur="5s" repeatCount="indefinite"/></text>
</g>
</g>
<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="16" fill="none" stroke="#4c1d95" stroke-opacity="0.6"/>
</svg>
`;
  fs.writeFileSync(OUT, svg);
  console.log(`wrote ${OUT}: ${svg.length} bytes | ${days.length} days, ${active.length} active, ${total} contributions, longest streak ${longest}, runs ${runs.length}`);
}
main().catch(e => { console.error(e); process.exit(1); });
