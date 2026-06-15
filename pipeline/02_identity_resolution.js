const seen = new Set();
const out = [];
for (const {json} of items) {
  const key = (json.fromEmail && `e:${json.fromEmail}`) ||
              (json.fromPhone && `p:${json.fromPhone}`) ||
              (json.fromName  && `n:${json.fromName.toLowerCase().trim()}`) || null;
  if (!key) continue;
  json.contactKey = key;
  const day = json.createdAtISO ? json.createdAtISO.slice(0,10) : 'na';
  const sig = `${key}|${(json.subject||'').toLowerCase()}|${day}|${json.channel}|${json.source}`;
  if (seen.has(sig)) continue; seen.add(sig);
  if (json._ts && (Date.now()-json._ts) > 96*3600*1000) continue;
  out.push({ json });
}
return out;