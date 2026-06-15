function stripFences(s) {
  if (typeof s !== 'string') return s;
  const m = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return m ? m[1].trim() : s.trim();
}
function safeParse(x) {
  if (x == null) return {};
  if (typeof x === 'object') return x;
  if (typeof x !== 'string') return {};
  const s = stripFences(x);
  try { return JSON.parse(s); } catch { return {}; }
}
function toISO(s) {
  if (!s) return null;
  try {
    if (s instanceof Date) return isNaN(s.getTime()) ? null : s.toISOString();
    if (typeof s === 'number') { const d = new Date(s); return isNaN(d.getTime()) ? null : d.toISOString(); }
    if (typeof s === 'string') {
      const d = new Date(s);
      if (!isNaN(d.getTime())) return d.toISOString();
      if (!/[zZ]|[+\-]\d{2}:\d{2}$/.test(s)) { const d2 = new Date(s + 'Z'); if (!isNaN(d2.getTime())) return d2.toISOString(); }
    }
  } catch {}
  return null;
}
function firstDefined(...vals) { for (const v of vals) if (v !== undefined && v !== null && v !== '') return v; return undefined; }
function num(x, fallback = 0) { const n = Number(x); return Number.isFinite(n) ? n : fallback; }
function htmlToText(html) {
  if (typeof html !== 'string') return html ?? null;
  return html.replace(/<br\s*\/?>/gi,'\n').replace(/<\/p>/gi,'\n').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<[^>]+>/g,'').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/&#39;/gi,"'").replace(/&quot;/gi,'"').trim();
}
function pickContent(obj) {
  const html = firstDefined(obj.body?.content, obj.htmlBody, obj.html);
  const texty = firstDefined(obj.bodyPreview,obj.previewText,obj.snippet,obj.text,obj.body,obj.message,obj.content,obj.summary,obj.originalMessage,obj.followUpMessage);
  const textFromHtml = html ? htmlToText(html) : null;
  return firstDefined(texty, textFromHtml, obj.subject) ?? null;
}
function pickTimestamp(obj) {
  return firstDefined(obj.created_at,obj.createdAt,obj.time,obj.date,obj.timestamp,obj.sent_at,obj.sentAt,obj.received_at,obj.receivedAt,obj.createdDateTime,obj.lastModifiedDateTime,obj.contactTime,obj.followUpTime,obj.first_message_at,obj.last_message_at);
}
function mapRole(val) {
  if (!val) return null;
  const s = String(val).toLowerCase();
  if (['human','user','customer','incoming','inbound','from_customer'].includes(s)) return 'human';
  if (['ai','assistant','agent','bot','outgoing','outbound','from_agent','system'].includes(s)) return 'ai';
  return null;
}
function inferRole(o) {
  const dir = firstDefined(o.direction, o.dir);
  const inc = firstDefined(o.incoming, o.is_incoming, o.isIncoming);
  if (dir) { const r = mapRole(dir); if (r) return r; }
  if (inc === true) return 'human';
  if (inc === false) return 'ai';
  const r2 = mapRole(firstDefined(o.role, o.message?.type, o.sender_type));
  if (r2) return r2;
  if (o.from?.emailAddress || o.sender?.emailAddress || o.from_email) return 'human';
  return null;
}
function computeBounds(explicitFirst, explicitLast, messages) {
  let first = toISO(explicitFirst) || null;
  let last = toISO(explicitLast) || null;
  if (!first || !last) {
    const times = messages.map(m => m.created_at).filter(Boolean).map(t => new Date(t).getTime()).filter(n => Number.isFinite(n)).sort((a,b) => a-b);
    if (times.length) { if (!first) first = new Date(times[0]).toISOString(); if (!last) last = new Date(times[times.length-1]).toISOString(); }
  }
  return { first, last };
}
function looksLikeChat(rec) { return Array.isArray(rec?.messages) || String(firstDefined(rec.message_type,rec.messageType,rec.type,'')).toLowerCase() === 'chat_thread'; }
function looksLikeEmail(rec) { const t = String(firstDefined(rec.message_type,rec.messageType,rec.type,'')).toLowerCase(); return t === 'email' || 'createdDateTime' in rec || 'bodyPreview' in rec || 'subject' in rec && ('from' in rec || 'sender' in rec || 'toRecipients' in rec || 'to' in rec); }
function looksLikeSms(rec) { const t = String(firstDefined(rec.message_type,rec.messageType,rec.type,'')).toLowerCase(); return t === 'sms' || t === 'text' || ('direction' in rec && ('text' in rec || 'body' in rec)); }
function looksLikePhone(rec) { const t = String(firstDefined(rec.message_type,rec.messageType,rec.type,'')).toLowerCase(); return t === 'phone' || t === 'call' || 'call_id' in rec || 'duration_seconds' in rec || 'caller_phone' in rec; }
function looksLikeCrm(rec) { const t = String(firstDefined(rec.message_type,rec.messageType,rec.type,'')).toLowerCase(); return t === 'crm' || t === 'crm_event' || 'crm_thread_id' in rec || 'pipeline' in rec || 'stage' in rec; }
function normalizeChatThread(rec) {
  const msgsIn = Array.isArray(rec.messages) ? rec.messages : [];
  const msgs = msgsIn.map(m => ({ id: m?.id ?? null, role: mapRole(m?.message?.type) ?? mapRole(m?.role) ?? inferRole(m), content: firstDefined(m?.message?.content, pickContent(m)), created_at: toISO(firstDefined(m?.created_at, pickTimestamp(m))), lead_name: firstDefined(m?.lead_name,m?.sender_name,m?.from_name) ?? null, lead_phone: firstDefined(m?.lead_phone,m?.sender_phone,m?.from_phone) ?? null, subject: m?.subject ?? null, channel: 'chat' }));
  const { first, last } = computeBounds(rec.first_message_at, rec.last_message_at, msgs);
  return { session_id: firstDefined(rec.session_id,rec.sessionId) ?? null, message_count: num(firstDefined(rec.message_count,rec.messageCount,msgs.length),msgs.length), first_message_at: first, last_message_at: last, lead: { name: firstDefined(rec.session_lead_name,rec.lead_name,rec.contact_name,rec.customerName) ?? null, phone: firstDefined(rec.session_lead_phone,rec.lead_phone,rec.contact_phone,rec.phoneNumber) ?? null, email: firstDefined(rec.email,rec.emailAddress) ?? null }, messages: msgs, message_type: firstDefined(rec.message_type,rec.messageType,rec.type,'chat_thread') };
}
function normalizeEmailLike(rec) {
  const fromName = firstDefined(rec.from?.emailAddress?.name,rec.sender?.emailAddress?.name,rec.from_name,rec.senderName);
  const fromAddr = firstDefined(rec.from?.emailAddress?.address,rec.sender?.emailAddress?.address,rec.from_email,rec.senderEmail);
  const toField = firstDefined(rec.toRecipients,rec.to,rec.to_email,rec.toAddress,rec.recipients);
  const content = pickContent(rec);
  const msg = { id: firstDefined(rec.id,rec.message_id,rec.internetMessageId,rec.conversationId,rec.uuid) ?? null, role: inferRole(rec) ?? 'human', content, created_at: toISO(firstDefined(rec.createdDateTime,rec.sentDateTime,rec.receivedDateTime,rec.internalDate,rec.date,pickTimestamp(rec))), lead_name: firstDefined(rec.contact_name,rec.customerName,fromName) ?? null, lead_phone: firstDefined(rec.contact_phone,rec.phoneNumber,rec.from_phone) ?? null, subject: firstDefined(rec.subject,rec.messageSubject,rec.thread_subject) ?? null, from: fromAddr || rec.from || rec.from_email || null, to: toField || null, channel: 'email' };
  const msgs = (msg.content || msg.created_at || msg.id || msg.subject || msg.from || msg.to) ? [msg] : [];
  const { first, last } = computeBounds(rec.first_message_at, rec.last_message_at, msgs);
  return { session_id: firstDefined(rec.session_id,rec.thread_id,rec.conversation_id,rec.conversationId) ?? null, message_count: msgs.length, first_message_at: first, last_message_at: last, lead: { name: firstDefined(rec.contact_name,rec.customerName,fromName) ?? null, phone: firstDefined(rec.contact_phone,rec.phoneNumber,rec.from_phone) ?? null, email: firstDefined(rec.email,rec.emailAddress,fromAddr) ?? null }, messages: msgs, message_type: firstDefined(rec.message_type,rec.messageType,rec.type,'email') };
}
function normalizeGeneric(rec) {
  const msg = { id: firstDefined(rec.id,rec.uuid,rec.event_id) ?? null, role: inferRole(rec), content: pickContent(rec), created_at: toISO(pickTimestamp(rec)), lead_name: firstDefined(rec.lead_name,rec.contact_name,rec.customerName) ?? null, lead_phone: firstDefined(rec.lead_phone,rec.contact_phone,rec.phoneNumber) ?? null, subject: rec.subject ?? null, channel: firstDefined(rec.channel,rec.type,'generic') };
  const msgs = (msg.content || msg.created_at || msg.id) ? [msg] : [];
  const { first, last } = computeBounds(rec.first_message_at, rec.last_message_at, msgs);
  return { session_id: firstDefined(rec.session_id,rec.thread_id,rec.conversation_id) ?? null, message_count: msgs.length, first_message_at: first, last_message_at: last, lead: { name: firstDefined(rec.contact_name,rec.customerName,rec.lead_name) ?? null, phone: firstDefined(rec.contact_phone,rec.phoneNumber,rec.lead_phone) ?? null, email: firstDefined(rec.email,rec.emailAddress) ?? null }, messages: msgs, message_type: firstDefined(rec.message_type,rec.messageType,rec.type,'generic') };
}
function normalizeRecord(rec) {
  if (!rec || typeof rec !== 'object') return normalizeGeneric({});
  if (looksLikeChat(rec)) return normalizeChatThread(rec);
  if (looksLikeEmail(rec)) return normalizeEmailLike(rec);
  if (looksLikeSms(rec)) return normalizeGeneric(rec);
  if (looksLikePhone(rec)) return normalizeGeneric(rec);
  if (looksLikeCrm(rec)) return normalizeGeneric(rec);
  return normalizeGeneric(rec);
}
function extractRecords(inputJson) {
  const raw = inputJson ?? {};
  let data = safeParse(raw.preview) && Object.keys(safeParse(raw.preview)).length ? safeParse(raw.preview) : safeParse(raw.output) && Object.keys(safeParse(raw.output)).length ? safeParse(raw.output) : safeParse(raw);
  if (typeof data === 'string') data = safeParse(data);
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.analysis)) return data.analysis;
  return [data];
}
const out = [];
for (const item of items) {
  const records = extractRecords(item?.json);
  for (const rec of records) {
    const normalized = normalizeRecord(rec || {});
    out.push({ json: { normalized, as_text: JSON.stringify(normalized, null, 2) } });
  }
}
return out.length ? out : [{ json: { normalized: null, as_text: '' } }];
