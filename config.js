// Central configuration for the triage agent.
// Edit the criteria and signature below to match your practice.
// Nothing secret lives here — API keys/tokens go in .env (gitignored).

export const config = {
  // Gmail search used to find candidate digest emails.
  // Tune the sender(s) / recency to match your actual listserv sources.
  gmailQuery: process.env.GMAIL_QUERY || "from:googlegroups.com is:unread newer_than:1d",

  // Max digest messages to pull per run.
  maxMessages: Number(process.env.MAX_MESSAGES || 10),

  // Dedup: after a digest is processed (non-dry-run), it gets this Gmail label,
  // and the search below excludes anything already labeled. This prevents the
  // daily run from drafting the same post twice, and works in CI (state lives
  // in Gmail, not on disk). Set to "" to disable.
  processedLabel: process.env.PROCESSED_LABEL || "Triaged",

  // Anthropic model. For a cheaper/faster option at higher volume, try
  // "claude-haiku-4-5". (Newer models manage sampling internally, so we don't
  // set a temperature.)
  anthropic: {
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
    maxTokens: 1024,
  },

  // If true, mark processed digests as read so they aren't re-processed.
  // Requires the gmail.modify scope.
  markProcessedRead: process.env.MARK_READ === "true",

  // Insurers you accept. A post must involve a patient with one of these
  // (or self-pay explicitly) to be a candidate.
  acceptedInsurers: [
    "Aetna",
    "Point32 / Harvard Pilgrim / Tufts",
    "Optum",
    "Evernorth",
    "Blue Cross Blue Shield (BCBS)",
    "Mass General Brigham (MGB)",
    "Cigna (incl. Evernorth behavioral health)",
    "Medicare",
    "Managed Medicare / Medicare Advantage plans",
  ],

  // The core clinical criteria that define a match.
  // This practice serves ADULTS (18+) in Massachusetts and New Hampshire,
  // offering INDIVIDUAL talk therapy AND psychiatric medication management /
  // prescribing (the practice has therapists and a PMHNP prescriber). It accepts
  // the insurers below, including Medicare and some Managed Medicare plans.
  criteria: [
    "The poster is seeking a therapist for INDIVIDUAL talk therapy, OR a prescriber / psychiatric medication management (psychiatrist, PMHNP, etc.). Either type matches. COUPLES therapy and FAMILY therapy do NOT match — the practice offers individual therapy only (medication management is fine).",
    "A request for a female therapist / female-identifying therapist DOES match. The practice has female therapists and this preference must NEVER be a reason to skip.",
    "The patient is an adult, age 18 or older. Requests for children, adolescents, or anyone under 18 do NOT match.",
    "The patient is located in, or the provider must be licensed in, Massachusetts or New Hampshire. Requests that clearly require another state (e.g. Maine, Pennsylvania) do NOT match. If no location is stated, do not exclude on location alone.",
    "The patient's insurance is one of the accepted insurers (which include Medicare and some Managed Medicare / Medicare Advantage plans), OR the poster explicitly states self-pay / out-of-network is acceptable. If insurance is not mentioned at all, treat as a weak/no match and explain.",
    "The request is an active referral seeking a provider (not a general discussion, training/CEU question, workshop or service announcement, or an already-filled request).",
  ],

  // Your signature block, appended to / used by draft replies.
  signature: process.env.SIGNATURE ||
    [
      "John Donovan FNP-BC, PMHNP-BC",
      "Bedre Health — www.BedreHealth.com",
      "P: (781) 488-6163 | F: (781) 443-8414",
      "To schedule an appointment, email: info@bedrehealth.com",
    ].join("\n"),
};
