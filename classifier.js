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
    "You are a triage assistant for an outpatient therapy practice that provides",
    "talk therapy for adults (age 18+) and does NOT accept Medicare.",
    "You review individual posts from a professional referral listserv and decide",
    "whether each post is a referral this practice should respond to.",
    "",
    "ACCEPTED INSURERS:",
    ...config.acceptedInsurers.map((i) => `- ${i}`),
    "",
    "MATCH CRITERIA (ALL must be satisfied to match):",
    ...config.criteria.map((c) => `- ${c}`),
    "",
    "When it matches, write a concise, warm, clinically appropriate reply that:",
    "- confirms availability to take the referral,",
    "- asks for any missing essential info (insurance confirmation, patient contact, urgency),",
    "- keeps it brief and professional,",
    "- ends with this exact signature block:",
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
    temperature: config.anthropic.temperature,
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
