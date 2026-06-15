-- lostContact table
-- Populated by the multi-source contact intelligence pipeline.
-- Consumed by the ops dashboard for contact queue display and resolution tracking.

CREATE TABLE IF NOT EXISTS public."lostContact" (
  id              SERIAL PRIMARY KEY,
  email           TEXT,
  channel         TEXT,                   -- 'Email' | 'Chat' | 'CRM'
  time            TIMESTAMPTZ,            -- original contact timestamp
  "fullName"      TEXT,
  phone           TEXT,                   -- normalized: +1XXXXXXXXXX
  "missedSummary" TEXT,                   -- original customer message / question
  "aiAnalysis"    TEXT,                   -- LLM reasoning for this contact
  status          TEXT,                   -- 'No Response Yet' | 'Response Sent'
  "isResolved"    BOOLEAN DEFAULT FALSE,  -- manually marked resolved in dashboard
  "confidenceScore" NUMERIC(4,3),         -- 0.000–1.000
  "hasResponse"   TEXT,                   -- 'true'/'false' as string (legacy compat)
  "followupMessage" TEXT                  -- the response sent, if any
);

-- Recommended: prevent duplicate inserts on pipeline re-runs
-- CREATE UNIQUE INDEX IF NOT EXISTS lostcontact_dedup
--   ON public."lostContact" (email, time, channel)
--   WHERE email IS NOT NULL;

-- Dashboard query: unresolved contacts, ranked by confidence desc, time asc
-- SELECT * FROM public."lostContact"
-- WHERE "isResolved" = FALSE
-- ORDER BY "confidenceScore" DESC, time ASC;
