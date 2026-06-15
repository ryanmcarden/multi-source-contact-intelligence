function pick(obj, path) { try { return path.split('.').reduce((o,k)=> o?.[k], obj); } catch { return undefined; } }

return items.map(({json}) => {
  const src = json.source;
  let fromName=null, fromEmail=null, body=null, subject=null, created=null, channel='Email', phone=null;

  if (src === 'inbox') {
    fromName  = pick(json, 'sender.emailAddress.name') ?? pick(json, 'from.emailAddress.name') ?? null;
    fromEmail = (pick(json, 'sender.emailAddress.address') ?? pick(json, 'from.emailAddress.address') ?? '').toLowerCase() || null;
    subject   = json.subject ?? null;
    body      = json.bodyPreview ?? json.body ?? null;
    created   = json.createdDateTime ?? null;
    channel   = 'Email';
  } else if (src === 'sent') {
    fromName  = 'Your Company';
    fromEmail = 'info@yourdomain.com';
    subject   = json.subject ?? null;
    body      = json.bodyPreview ?? json.body ?? null;
    created   = json.sentDateTime ?? json.createdDateTime ?? null;
    channel   = 'Email';
  } else if (src === 'chat') {
    fromName  = json.lead_name ?? null;
    phone     = json.lead_phone ? String(json.lead_phone).replace(/\D+/g,'') : null;
    subject   = (json.msg_type === 'human' ? 'Chat inbound' : json.msg_type === 'ai' ? 'Chat AI reply' : 'Chat message');
    body      = json.msg_content ?? null;
    created   = json.created_at ?? null;
    channel   = 'Chat';
  } else if (src === 'crm') {
    fromName  = json.FullName ?? null;
    fromEmail = (json.Email || '').toLowerCase() || null;
    subject   = json.ContactType ?? 'CRM Note';
    body      = json.ContactNotes ?? null;
    created   = json.createdDateTime ?? null;
    channel   = 'CRM';
  }

  if (phone) {
    if (phone.length === 10) phone = `+1${phone}`;
    else if (phone.length === 11 && phone.startsWith('1')) phone = `+${phone}`;
  }

  const createdAtISO = created ? new Date(created).toISOString() : null;

  return {
    json: {
      source: src, channel, fromName, fromEmail,
      fromPhone: phone ?? null,
      subject, body, createdAtISO,
      _ts: createdAtISO ? Date.parse(createdAtISO) : null
    }
  };
});