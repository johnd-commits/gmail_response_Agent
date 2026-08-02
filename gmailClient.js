import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(__dirname, "token.json");

// Scope note: gmail.modify covers read, draft creation, and marking read /
// labeling. It cannot permanently delete mail. This is the minimum scope that
// supports our drafts-first + "mark processed" workflow.
export const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];

/**
 * Loads OAuth client id/secret from env vars (preferred for CI) or from a
 * downloaded credentials.json (preferred for local dev).
 */
export function loadClientSecrets() {
  if (process.env.GMAIL_CLIENT_ID && process.env.GMAIL_CLIENT_SECRET) {
    return {
      clientId: process.env.GMAIL_CLIENT_ID,
      clientSecret: process.env.GMAIL_CLIENT_SECRET,
      redirectUri: process.env.GMAIL_REDIRECT_URI || "http://localhost",
    };
  }

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      "No Gmail credentials found. Provide GMAIL_CLIENT_ID/GMAIL_CLIENT_SECRET " +
        "in .env, or place your downloaded credentials.json in the project root."
    );
  }

  const raw = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  const key = raw.installed || raw.web;
  if (!key) {
    throw new Error("credentials.json is not a Desktop/Web OAuth client file.");
  }
  return {
    clientId: key.client_id,
    clientSecret: key.client_secret,
    redirectUri: (key.redirect_uris && key.redirect_uris[0]) || "http://localhost",
  };
}

export function createOAuth2Client(redirectUri) {
  const { clientId, clientSecret, redirectUri: defaultRedirect } = loadClientSecrets();
  return new google.auth.OAuth2(clientId, clientSecret, redirectUri || defaultRedirect);
}

/**
 * Returns an authorized OAuth2 client using a stored refresh token.
 * Refresh token is read from GMAIL_REFRESH_TOKEN (CI) or token.json (local).
 */
export function getAuthorizedClient() {
  const oauth2 = createOAuth2Client();

  if (process.env.GMAIL_REFRESH_TOKEN) {
    oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
    return oauth2;
  }

  if (fs.existsSync(TOKEN_PATH)) {
    const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
    oauth2.setCredentials(token);
    return oauth2;
  }

  throw new Error(
    "Not authorized yet. Run `npm run auth` to complete the one-time OAuth flow " +
      "(or set GMAIL_REFRESH_TOKEN in .env)."
  );
}

export function saveToken(tokens) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

export function getGmail(auth = getAuthorizedClient()) {
  return google.gmail({ version: "v1", auth });
}

/** Lists message ids matching a Gmail search query. */
export async function listMessages(gmail, query, maxResults = 10) {
  const res = await gmail.users.messages.list({
    userId: "me",
    q: query,
    maxResults,
  });
  return res.data.messages || [];
}

/** Fetches a full message (format=full) by id. */
export async function getMessage(gmail, id) {
  const res = await gmail.users.messages.get({ userId: "me", id, format: "full" });
  return res.data;
}

/** Reads a header value (case-insensitive) from a message payload. */
export function getHeader(message, name) {
  const headers = message?.payload?.headers || [];
  const found = headers.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found ? found.value : undefined;
}

/** Recursively extracts and decodes the text/plain body of a message. */
export function getPlainTextBody(message) {
  const payload = message?.payload;
  if (!payload) return "";

  const decode = (data) =>
    data ? Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "";

  const walk = (part) => {
    if (!part) return "";
    if (part.mimeType === "text/plain" && part.body?.data) return decode(part.body.data);
    if (part.parts) {
      for (const child of part.parts) {
        const text = walk(child);
        if (text) return text;
      }
    }
    return "";
  };

  // Single-part message.
  if (payload.body?.data && payload.mimeType === "text/plain") {
    return decode(payload.body.data);
  }
  return walk(payload);
}

function base64UrlEncode(str) {
  return Buffer.from(str, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/**
 * Builds a raw RFC 2822 reply MIME string that threads correctly.
 * Pass the original message so we can set To/Subject/In-Reply-To/References.
 */
export function buildReplyRaw({ toEmail, subject, inReplyTo, references, bodyText, fromEmail }) {
  const replySubject = /^re:/i.test(subject || "") ? subject : `Re: ${subject || ""}`.trim();
  const lines = [];
  if (fromEmail) lines.push(`From: ${fromEmail}`);
  lines.push(`To: ${toEmail}`);
  lines.push(`Subject: ${replySubject}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  lines.push('Content-Type: text/plain; charset="UTF-8"');
  lines.push("MIME-Version: 1.0");
  lines.push("");
  lines.push(bodyText);
  return base64UrlEncode(lines.join("\r\n"));
}

/**
 * Creates a draft. If threadId is provided, the draft is threaded as a reply.
 * NOTE: This never sends. There is intentionally no send() helper here.
 */
export async function createDraft(gmail, { raw, threadId }) {
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw,
        ...(threadId ? { threadId } : {}),
      },
    },
  });
  return res.data;
}

/**
 * Creates a standalone referral draft addressed to the poster. This is NOT
 * threaded onto the digest — each referral becomes its own draft/conversation
 * so they appear as separate items in the Drafts folder.
 */
export async function createReferralDraft(gmail, { toEmail, subject, bodyText }) {
  const raw = buildReplyRaw({ toEmail, subject, bodyText });
  return createDraft(gmail, { raw });
}

/** Convenience: create a threaded reply draft to an original message object. */
export async function createReplyDraft(gmail, originalMessage, bodyText, overrideToEmail) {
  const from = getHeader(originalMessage, "From");
  const subject = getHeader(originalMessage, "Subject");
  const messageId = getHeader(originalMessage, "Message-ID") || getHeader(originalMessage, "Message-Id");
  const priorRefs = getHeader(originalMessage, "References");
  const references = [priorRefs, messageId].filter(Boolean).join(" ");

  const raw = buildReplyRaw({
    toEmail: overrideToEmail || from,
    subject,
    inReplyTo: messageId,
    references,
    bodyText,
  });

  return createDraft(gmail, { raw, threadId: originalMessage.threadId });
}

export async function markAsRead(gmail, id) {
  await gmail.users.messages.modify({
    userId: "me",
    id,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });
}

/** Returns the id of an existing label, or null if it doesn't exist. */
export async function getLabelId(gmail, name) {
  const res = await gmail.users.labels.list({ userId: "me" });
  const existing = (res.data.labels || []).find((l) => l.name === name);
  return existing ? existing.id : null;
}

/** Returns the id of a label, creating it if it doesn't exist. */
export async function ensureLabel(gmail, name) {
  const existingId = await getLabelId(gmail, name);
  if (existingId) return existingId;
  const created = await gmail.users.labels.create({
    userId: "me",
    requestBody: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  return created.data.id;
}

export async function addLabel(gmail, id, labelId) {
  await gmail.users.messages.modify({
    userId: "me",
    id,
    requestBody: { addLabelIds: [labelId] },
  });
}
