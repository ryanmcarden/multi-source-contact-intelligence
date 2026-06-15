function stripCodeFence(s) {
  if (typeof s !== 'string') return s;
  let m = s.match(/```json\s*([\s\S]*?)```/i);
  if (m && m[1]) return m[1].trim();
  m = s.match(/```\s*([\s\S]*?)```/);
  if (m && m[1]) return m[1].trim();
  return s.trim();
}
function extractJsonCandidate(s) {
  if (typeof s !== 'string') return s;
  const stripped = stripCodeFence(s);
  if (/^\s*[\{\[]/.test(stripped)) return stripped;
  const start = stripped.indexOf('{'); const end = stripped.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) return stripped.slice(start, end+1);
  return null;
}
function safeParse(x) {
  if (x == null) return null;
  if (typeof x === 'object') return x;
  if (typeof x !== 'string') return null;
  const cand = extractJsonCandidate(x);
  if (!cand) return null;
  try { return JSON.parse(cand); } catch (_e) {
    const softened = cand.replace(/\r\n/g,'\n').replace(/\\n/g,'\n').replace(/\\"/g,'"');
    try { return JSON.parse(softened); } catch (_e2) { return null; }
  }
}
function nilIfEmpty(v) {
  if (v == null) return null;
  if (typeof v === 'string') { const t = v.trim(); if (!t) return null; if (['unknown','n/a','na'].includes(t.toLowerCase())) return null; return t; }
  return v;
}
function toISOZ(s) {
  if (!s) return null;
  if (typeof s !== 'string') { const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); }
  const t = s.trim(); if (!t) return null;
  let d = new Date(t); if (!isNaN(d.getTime())) return d.toISOString();
  if (!/[zZ]|[+\-]\d{2}:\d{2}$/.test(t)) { d = new Date(t+'Z'); if (!isNaN(d.getTime())) return d.toISOString(); }
  return null;
}
function toMillis(iso) { if (!iso) return null; const ms = Date.parse(iso); return Number.isFinite(ms) ? ms : null; }
function normalizePhone(p) {
  if (p == null) return null; const s = String(p).trim(); if (!s) return null;
  if (s.startsWith('+')) { const digits = '+' + s.slice(1).replace(/\D+/g,''); return digits.length > 1 ? digits : null; }
  const digits = s.replace(/\D+/g,''); return digits || null;
}
function normalizeChannel(ch) {
  const t = nilIfEmpty(ch); if (!t) return null; const c = t.toLowerCase();
  if (c.startsWith('chat')) return 'Chat'; if (c.startsWith('email')) return 'Email';
  if (c.startsWith('sms')) return 'SMS'; if (c.includes('phone')) return 'Phone';
  return t.charAt(0).toUpperCase() + t.slice(1);
}
function boolHasResponse(status) { if (!status) return false; const s = String(status).toLowerCase(); return s.includes('response sent') || s.includes('resolved'); }
const out = [];
for (let i = 0; i < items.length; i++) {
  const raw = items[i]?.json?.output ?? items[i]?.json ?? null;
  const parsed = safeParse(raw);
  if (!parsed || !parsed.analysis || !Array.isArray(parsed.analysis)) continue;
  for (const row of parsed.analysis) {
    const customerName = nilIfEmpty(row.customerName);
    const emailAddress = nilIfEmpty(row.emailAddress);
    const phoneNumber = normalizePhone(row.phoneNumber);
    const channel = normalizeChannel(row.channel);
    const customerQuestion = nilIfEmpty(row.originalMessage);
    const contactTime_iso = toISOZ(row.contactTime);
    const contactTime_ms = toMillis(contactTime_iso);
    const followUpTime_iso = toISOZ(row.followUpTime);
    const followUpTime_ms = toMillis(followUpTime_iso);
    let confidenceScore = row.confidenceScore;
    if (confidenceScore !== null && confidenceScore !== undefined) { const n = Number(confidenceScore); confidenceScore = Number.isFinite(n) ? n : null; } else { confidenceScore = null; }
    const status = nilIfEmpty(row.status);
    const followUpMessage = nilIfEmpty(row.followUpMessage);
    const reasoning = nilIfEmpty(row.reasoning);
    out.push({ json: { customerName, emailAddress, phoneNumber, channel, customerQuestion, followUpMessage, status, confidenceScore, reasoning, contactTime_iso, contactTime_ms, followUpTime_iso, followUpTime_ms, hasResponse: boolHasResponse(status), _sourceIndex: i } });
  }
}
return out;
