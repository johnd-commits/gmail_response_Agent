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
    "The practice has female therapists on staff. Requests for a female therapist",
    "are a match — never skip them for that reason.",
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
    "When it matches, write a short, warm reply whose ONLY goal is to make it",
    "effortless for the referrer to send the client to us. We do the selling; we",
    "put ZERO work back on the referrer. Follow these rules exactly:",
    "- Briefly reflect back the type of care they're seeking so it's clear we fit",
    "  (e.g. 'individual therapy for an adult client working through OCD').",
    "- Affirmatively state that we accept the insurance named in their post (name",
    "  it). It only reached this step because the insurance is one we accept.",
    "- State that we have immediate availability.",
    "- If they asked for a female therapist, you MAY affirm that we have female",
    "  therapists available. Do not invent other clinician attributes.",
    "- Warmly invite the referral and tell them the client can reach us directly",
    "  at info@bedrehealth.com or (781) 488-6163. Frame it as easy for them.",
    "- Include this exact sentence near the end of the body (before the signature),",
    "  because the PDF is attached automatically by the system:",
    `  "${config.referralSheet.mention}"`,
    "- Do NOT ask the referrer to confirm insurance, collect contact details, or",
    "  provide urgency/plan specifics. Never put a task back on them.",
    "- Do NOT invent specifics: no particular days/times, clinician names,",
    "  specialties, or modalities (telehealth/in-person). Availability is",
    "  described only as 'immediate availability' (plus female therapists when asked).",
    "- Keep it brief before the signature.",
    "- End with this exact signature block, verbatim:",
    config.signature,
    "",
    "Return your decision by calling the record_triage tool. If matches is false,",
    "set draftReply to an empty string.",
  ].join("\n");
}

const TRIAGE_TOOL = {
  name: "record_triage",
  description: "Record the triage decision and, when applicable, the draft reply.",
  input_schema: {
    type: "object",
    properties: {
      matches: {
        type: "boolean",
        description: "True if this post is a referral the practice should respond to.",
      },
      reason: {
        type: "string",
        description: "A brief explanation of the decision.",
      },
      draftReply: {
        type: "string",
        description: "The full draft reply when matches is true; otherwise an empty string.",
      },
    },
    required: ["matches", "reason", "draftReply"],
  },
};

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

/**
 * Classifies a single parsed post. Returns { matches, reason, draftReply }.
 * Uses Anthropic tool use so the structured result is returned as a validated
 * object (no fragile text/JSON parsing of multi-line draft bodies).
 */
export async function classifyPost(post) {
  const anthropic = getClient();
  const res = await anthropic.messages.create({
    model: config.anthropic.model,
    max_tokens: config.anthropic.maxTokens,
    system: buildSystemPrompt(),
    tools: [TRIAGE_TOOL],
    tool_choice: { type: "tool", name: "record_triage" },
    messages: [{ role: "user", content: buildUserPrompt(post) }],
  });

  const toolUse = res.content.find(
    (b) => b.type === "tool_use" && b.name === "record_triage"
  );
  if (!toolUse) {
    throw new Error("Model did not return a record_triage tool call.");
  }

  const input = toolUse.input || {};
  return {
    matches: Boolean(input.matches),
    reason: input.reason || "",
    draftReply: input.draftReply || "",
  };
}
