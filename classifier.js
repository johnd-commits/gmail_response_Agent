import Anthropic from "@anthropic-ai/sdk";
import { config } from "./config.js";

let client;
function getClient() {
  if (!client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is not set. Add it to your .env file.");
    }
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

function buildSystemPrompt() {
  return [
    "You are a triage assistant for Bedre Health, an outpatient practice serving",
    "adults (age 18+) in Massachusetts and New Hampshire. The practice offers",
    "INDIVIDUAL talk therapy and psychiatric medication management / prescribing.",
    "It accepts the insurers listed below, including Medicare and some Managed",
    "Medicare / Medicare Advantage plans.",
    "You review individual posts from a professional referral listserv and decide",
    "whether each post is a referral this practice should respond to.",
    "",
    "ACCEPTED INSURERS:",
    ...config.acceptedInsurers.map((i) => `- ${i}`),
    "",
    "MATCH CRITERIA (ALL must be satisfied to match):",
    ...config.criteria.map((c) => `- ${c}`),
    "",
    "When it matches, write a concise, warm, professional reply. CRITICAL RULES",
    "for the reply — follow exactly:",
    "- Do NOT invent or promise any specifics. Never state particular days,",
    "  times, schedules, clinician names, genders, specialties, or modalities.",
    "- State only that we have immediate availability.",
    "- Ask the referrer to confirm the patient's insurance and to share the best",
    "  contact info (or have the patient reach out), plus any urgency.",
    "- Invite them to email info@bedrehealth.com to get started.",
    "- Keep it brief (a few sentences). Do not claim anything not stated above.",
    "- End with this exact signature block, verbatim:",
    config.signature,
    "",
    "Respond with ONLY a JSON object, no prose, no code fences, of the form:",
    '{"matches": boolean, "reason": string, "draftReply": string}',
    'If matches is false, set draftReply to "".',
  ].join("\n");
}

function buildUserPrompt(post) {
  return [
    "Evaluate this listserv post:",
    "",
    `Topic/Subject: ${post.topic}`,
    `Poster: ${post.sender}${post.senderEmail ? ` <${post.senderEmail}>` : ""}`,
    post.link ? `Link: ${post.link}` : "",
    "",
    "Post body:",
    post.body || post.snippet || "(no body)",
  ]
    .filter(Boolean)
    .join("\n");
}

function extractJson(text) {
  const cleaned = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(cleaned.slice(start, end + 1));
    }
    throw new Error(`Could not parse JSON from model response: ${text.slice(0, 200)}`);
  }
}

/**
 * Classifies a single parsed post. Returns { matches, reason, draftReply }.
 */
export async function classifyPost(post) {
  const anthropic = getClient();
  const res = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.maxTokens,
    system: buildSystemPrompt(),
    messages: [{ role: "user", content: buildUserPrompt(post) }],
  });

  const text = res.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const parsed = extractJson(text);
  return {
    matches: Boolean(parsed.matches),
    reason: parsed.reason || "",
    draftReply: parsed.draftReply || "",
  };
}
