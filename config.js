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
  // For a cheaper/faster option at higher volume, try "claude-haiku-4-5".
  anthropic: {
    model: process.env.ANTHROPIC_MODEL || "claude-sonnet-5",
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
    "Managed Medicare / Medicare Advantage plans",
  ],

  // The core clinical criteria that define a match.
  // This practice provides THERAPY (talk therapy) for ADULTS (18+) and accepts
  // Medicare and some Managed Medicare / Medicare Advantage plans.
  criteria: [
    "The poster is seeking a therapist / talk therapy (individual, couples, family, etc.). Requests seeking ONLY a prescriber or medication management do NOT match — this practice provides therapy, not prescribing.",
    "The patient is an adult, age 18 or older. Requests for children, adolescents, or anyone under 18 do NOT match.",
    "The patient's insurance is one of the accepted insurers (which include Medicare and some Managed Medicare / Medicare Advantage plans), OR the poster explicitly states self-pay. If insurance is not mentioned at all, treat as a weak/no match and explain.",
    "The request is an active referral seeking a provider (not a general discussion, job posting, or administrative notice).",
  ],

  // Your signature block, appended to / used by draft replies.
  // TODO: replace with your real name, credentials, practice, and contact.
  signature: process.env.SIGNATURE ||
    [
      "John Donovan FNP-BC, PMHNP-BC",
      "Bedre Health — www.BedreHealth.com",
      "P: (781) 488-6163 | F: (781) 443-8414",
      "To schedule an appointment, email: info@bedrehealth.com",
    ].join("\n"),
};
