// Central configuration for the triage agent.
// Edit the criteria and signature below to match your practice.
// Nothing secret lives here — API keys/tokens go in .env (gitignored).

export const config = {
  // Gmail search used to find candidate digest emails.
  // Tune the sender(s) / recency to match your actual listserv sources.
  gmailQuery: process.env.GMAIL_QUERY || "from:googlegroups.com is:unread newer_than:1d",

  // Max digest messages to pull per run.
  maxMessages: Number(process.env.MAX_MESSAGES || 10),

  // Anthropic model + sampling. Low temperature for consistent classification.
  anthropic: {
    model: process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest",
    maxTokens: 1024,
    temperature: 0,
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
    "Medicare",
  ],

  // The core clinical criteria that define a match.
  criteria: [
    "The poster is seeking medication management / a prescriber (psychiatrist, psychiatric NP/PA). Therapy-only requests do NOT match.",
    "The patient's insurance is one of the accepted insurers, OR the poster explicitly states self-pay. If insurance is not mentioned at all, treat as a weak/no match and explain.",
    "The request is an active referral seeking a provider (not a general discussion, job posting, or administrative notice).",
  ],

  // Your signature block, appended to / used by draft replies.
  // TODO: replace with your real name, credentials, practice, and contact.
  signature: process.env.SIGNATURE ||
    [
      "[Your Name], [Credentials]",
      "[Practice Name]",
      "[Phone] | [Email]",
      "[Availability / how to refer]",
    ].join("\n"),
};
