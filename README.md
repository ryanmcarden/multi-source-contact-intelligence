# Multi-Source Contact Intelligence

A scheduled data pipeline that recovers missed customer contacts by fusing four heterogeneous data sources — modern SaaS inbox, cloud database, AI chat system, and a legacy on-premise CRM — then uses an LLM agent with direct tool access to enrich and classify each unresponded contact.

Built to solve a real problem at a business running a proprietary legacy CRM alongside modern cloud infrastructure: no single system has the full picture of who contacted you and whether anyone responded.

---

## The Problem

Customer contacts arrive across multiple channels with no unified view:

- Inbound emails in a cloud inbox
- Live chat sessions handled by an AI agent (stored in PostgreSQL)
- Notes logged by staff in a 20-year-old on-premise SQL Server CRM
- Outbound replies in a separate sent folder

No system talks to the others. A contact that came in via chat might have been followed up by email — but neither system knows about the other. The result: missed contacts that appear in one system but not the one being checked.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Scheduled Trigger (12h)               │
└─────────────────┬───────────────────────────────────────┘
                  │ computes 96-hour lookback window
                  │
        ┌─────────┴──────────┐
        │  Parallel Data Pull │
        └─────────┬──────────┘
                  │
    ┌─────────────┼─────────────┬──────────────────┐
    ▼             ▼             ▼                  ▼
 Outlook       Outlook       PostgreSQL         SQL Server
 Inbox         Sent          Chat History       Legacy CRM
 (96h)         (96h)         (96h flat rows)    (96h contact log)
    │             │             │                  │
    └─────────────┴─────────────┴──────────────────┘
                  │
                  ▼
         [ 01 ] Normalize
         All records → canonical shape
                  │
                  ▼
         [ 02 ] Identity Resolution
         Build contact key: email → phone → name
         Deduplicate by key + day + channel + source
                  │
                  ▼
         [ 03 ] Correlate
         Group by contact key
         Find inbound messages, check for follow-ups
         within 96-hour response window
                  │
                  ▼
         [ 04 ] Keyword Classifier
         Flag escalation signals before hitting LLM:
         undeliverable, abuse, payment, quote, proof
                  │
                  ▼
         Filter: No Response Yet only
                  │
                  ▼
         [ 05 ] AI Input Formatter
         Universal normalizer — handles chat threads,
         emails, CRM events; outputs structured context
         for LLM consumption
                  │
                  ▼
         [ 06 ] GPT-4o Agent
         Tool access: CRM lookup by email or name
         Extracts: customer question, reasoning,
         confidence score, status
                  │
                  ▼
         [ 07 ] AI Output Parser
         Strict schema normalization, ISO timestamps,
         phone canonicalization, null-safe field extraction
                  │
                  ▼
         Write → lostContact (PostgreSQL)
```

---

## Pipeline Stages

### Stage 1 — Normalize ([`pipeline/01_normalize.js`](pipeline/01_normalize.js))

Each of the four data sources has a completely different shape. This stage maps all of them to a single canonical record:

```js
{
  source,        // 'inbox' | 'sent' | 'chat' | 'crm'
  channel,       // 'Email' | 'Chat' | 'CRM'
  fromName,
  fromEmail,
  fromPhone,
  subject,
  body,
  createdAtISO,
  _ts            // parsed epoch ms for arithmetic
}
```

Key decisions:
- Sent emails are tagged with the company's own address — this is what lets the correlator identify "a reply was sent" without any explicit flag
- Chat messages are split by type (`human` vs `ai`) before canonicalization, so inbound vs AI-reply can be detected downstream
- Phone numbers are normalized to `+1XXXXXXXXXX` at this stage

### Stage 2 — Identity Resolution ([`pipeline/02_identity_resolution.js`](pipeline/02_identity_resolution.js))

Builds a deterministic contact key using a priority chain:

```
email (most reliable) → phone → name (fallback)
```

Deduplication signature: `contactKey | subject | day | channel | source`

This prevents the same email appearing as three separate records because it arrived in both the inbox and the sent CRM log. It also drops any record older than the 96-hour window (a safety net against timezone edge cases in the upstream queries).

### Stage 3 — Correlate ([`pipeline/03_correlate.js`](pipeline/03_correlate.js))

Groups all canonical records by contact key. For each group:

1. Identifies **inbound** messages (inbox email or human-side chat message)
2. Takes the earliest inbound as the "first contact" timestamp
3. Looks for any **follow-up** within a 96-hour window: sent email, CRM note, or AI chat reply
4. Emits a single record per contact with `status: 'No Response Yet'` or `'Response Sent'`, the follow-up message if found, and a base confidence score

This is the core deduplication logic — a customer who emailed twice and got one reply comes out as one record with `Response Sent`, not two missed contacts.

### Stage 4 — Keyword Classifier ([`pipeline/04_keyword_classifier.js`](pipeline/04_keyword_classifier.js))

Runs before the LLM to flag high-priority contacts cheaply:

```js
const signals = [
  /undeliverable/i,   // bounce — address may be wrong
  /proof/i,           // artwork approval pending
  /quote|cost/i,      // pricing inquiry
  /payment|visa|card/i, // transaction issue
  /abuse/i            // escalation
];
```

Priority is set to `'High'` or `'Normal'` and passed through to the output. Running regex classification before LLM invocation avoids burning tokens on routine contacts and lets the downstream system surface urgent cases even if the AI step fails.

### Stage 5 — AI Input Formatter ([`pipeline/05_ai_input_formatter.js`](pipeline/05_ai_input_formatter.js))

The messiest stage. By the time data reaches the LLM, it may have passed through three different normalization attempts. This stage is a defensive universal normalizer that:

- Detects record type by shape heuristics (`looksLikeChat`, `looksLikeEmail`, `looksLikeCrm`, etc.)
- Extracts body content from HTML, plain text, preview fields, or nested objects
- Reconstructs message timelines from whatever timestamp fields exist
- Handles partial data gracefully — missing fields produce `null`, not crashes

This stage exists because real-world data from a legacy CRM and multiple SaaS APIs never arrives in the shape the schema says it should.

### Stage 6 — GPT-4o Agent with Tool Use

The LLM receives a structured summary of the contact and has access to two SQL tools:

- **Lookup by email** — queries `legacy_crm.dbo.Customers` by email address
- **Lookup by name** — queries the same table by `InitialContact` field

It returns:
```json
{
  "customerName": "...",
  "emailAddress": "...",
  "phoneNumber": "...",
  "originalMessage": "Summary of what the customer asked",
  "status": "No Response Yet | Response Sent | ...",
  "followUpMessage": "...",
  "confidenceScore": 0.0–1.0,
  "reasoning": "..."
}
```

The agent is instructed to use its tools when contact info is missing rather than guessing, which is the key advantage of tool-use over a pure completion call.

### Stage 7 — AI Output Parser ([`pipeline/06_ai_output_parser.js`](pipeline/06_ai_output_parser.js))

LLM output is messy. This stage:

- Strips markdown code fences from JSON responses
- Handles double-encoded strings (LLMs sometimes stringify JSON inside JSON)
- Normalizes all timestamps to ISO 8601
- Canonicalizes phone numbers
- Coerces confidence scores to floats
- Drops records with no `customerName` (artifacts from empty sessions)

---

## Output Schema

Results are written to a `lostContact` table in PostgreSQL. See [`schema/lostcontact.sql`](schema/lostcontact.sql).

| Column | Type | Description |
|---|---|---|
| `email` | text | Customer email |
| `channel` | text | Email / Chat / CRM |
| `time` | timestamptz | Original contact time |
| `fullName` | text | Customer name |
| `phone` | text | Normalized phone |
| `missedSummary` | text | Original message summary |
| `aiAnalysis` | text | LLM reasoning |
| `status` | text | No Response Yet / Response Sent |
| `isResolved` | boolean | Manually marked resolved |
| `confidenceScore` | numeric | 0.0–1.0 |
| `hasResponse` | text | Boolean-as-string (legacy compat) |
| `followupMessage` | text | The response that was sent, if any |

---

## Data Sources

| Source | System | Protocol |
|---|---|---|
| Inbox | Microsoft Outlook (cloud) | Graph API / OAuth2 |
| Sent folder | Microsoft Outlook (cloud) | Graph API / OAuth2 |
| Chat history | PostgreSQL | Direct SQL |
| CRM contact log | Microsoft SQL Server (on-premise) | SQL Server driver |

The CRM (`legacy_crm`) is a proprietary legacy system with no public API. Access is read-only via a service account with minimal permissions. The LLM tools execute parameterized queries against it directly — no middleware layer.

---

## Key Design Decisions

**Why run keyword classification before the LLM?**
Token cost and reliability. Regex never hallucinates. If the AI step fails or times out, high-priority contacts are still flagged.

**Why 96 hours for the correlation window?**
Empirically, most follow-ups either happen within a business day or get lost entirely. 96 hours (4 days) catches weekend gaps without pulling in contacts so old they're no longer actionable.

**Why email → phone → name for the contact key?**
Email is the most collision-resistant identifier. Phone is second. Name alone is a last resort — it can produce false matches (two customers named "John Smith") but is better than dropping the contact entirely.

**Why tool-use instead of putting CRM data in the prompt?**
The CRM has hundreds of thousands of records. Dumping relevant rows into context would require a retrieval step that introduces its own errors. Tool-use lets the model decide when it needs more data and what to query for, which produces more targeted lookups and better reasoning.

---

## Running It

1. Import [`reference/workflow.json`](reference/workflow.json) into your workflow orchestrator
2. Configure credentials for:
   - Microsoft Outlook (OAuth2)
   - PostgreSQL
   - Microsoft SQL Server (read-only)
   - OpenAI API (GPT-4o)
3. Create the `lostContact` table using [`schema/lostcontact.sql`](schema/lostcontact.sql)
4. Adjust the lookback window (`96 hours`) and schedule (`12 hours`) to match your response SLA

The pipeline stages in `pipeline/` are plain JavaScript and can be ported to any runtime or orchestrator independently of the reference workflow.

---

## Related

- [`rag-chatbot-ops`](https://github.com/ryanmcarden/rag-chatbot-ops) — the ops dashboard that surfaces this pipeline's output as a ranked contact queue with one-click follow-up actions
