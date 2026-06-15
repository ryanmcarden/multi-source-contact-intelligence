const rows = items.map(i=>i.json);
const byKey = new Map();
for (const r of rows) {
  const g = byKey.get(r.contactKey) || { contactKey: r.contactKey, msgs: [] };
  g.msgs.push(r);
  byKey.set(r.contactKey, g);
}
const out = [];
for (const g of byKey.values()) {
  const inbound = g.msgs.filter(m => {
    if (m.channel === 'Email' && m.source === 'inbox') return true;
    if (m.channel === 'Chat' && m.source === 'chat' && m.subject === 'Chat inbound') return true;
    return false;
  }).sort((a,b)=> (a._ts||0)-(b._ts||0));
  if (!inbound.length) continue;
  const first = inbound[0];
  const horizon = (first._ts||0) + 96*3600*1000;
  const followups = g.msgs.filter(m => {
    const isFollow = (m.source === 'sent') || (m.channel === 'CRM') || (m.channel==='Chat' && m.source==='chat' && m.subject==='Chat AI reply');
    return isFollow && m._ts != null && m._ts >= (first._ts||0) && m._ts <= horizon;
  }).sort((a,b)=> (a._ts||0)-(b._ts||0));
  const status = followups.length ? 'Response Sent' : 'No Response Yet';
  const fu = followups[0];
  out.push({ json: {
    customerName: first.fromName || null,
    emailAddress: first.fromEmail || null,
    phoneNumber: first.fromPhone || null,
    channel: first.channel,
    originalMessage: first.subject || first.body || '(no preview)',
    contactTime: first.createdAtISO,
    status,
    followUpMessage: fu ? (fu.subject || fu.body || null) : null,
    followUpTime: fu ? fu.createdAtISO : null,
    confidenceScore: followups.length ? 0.9 : 0.7,
    reasoning: followups.length ? 'Found follow-up within 96 hours.' : 'No sent/CRM/AI reply found within 96 hours.'
  }});
}
return out;