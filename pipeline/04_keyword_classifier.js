const hot = [/undeliverable/i, /proof/i, /quote|cost/i, /payment|visa|card/i, /abuse/i];
return items.map(i => {
  const s = `${i.json.originalMessage||''} ${i.json.followUpMessage||''}`;
  i.json.priority = hot.some(rx => rx.test(s)) ? 'High' : 'Normal';
  return i;
});