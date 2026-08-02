import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Parser for Google Groups digest emails. Real digests look like:
//
//   ====================...
//   Today's topic summary
//   ====================...
//   Group: ...
//   Url: ...
//     - Topic title [1 Update]
//       http://groups.google.com/...
//
//   ====================...
//   Topic: <topic title>
//   Url: <topic url>
//   ====================...
//
//   ---------- 1 of 2 ----------
//   From: Jane Doe <jane@example.com>
//   Date: Jul 31 12:32PM -0400
//   Url: http://groups.google.com/.../msg/...
//
//   <message body, possibly with quoted replies>
//
//   --
//   You received this message because you are subscribed ...
//
// A parsed post looks like:
//   { topic, sender, senderEmail, date, link, snippet, body }

const TOPIC_RE = /^Topic:\s*(.+)$/;
const URL_RE = /^Url:\s*(\S+)/;
const FROM_RE = /^From:\s*(.+)$/;
const DATE_RE = /^Date:\s*(.+)$/;
const MSG_DELIM_RE = /^-{5,}\s*\d+\s+of\s+\d+\s*-{5,}/;

// Lines that mark the start of Google's per-message / digest footer boilerplate.
const FOOTER_RE =
  /^(You received this (message|digest)|To unsubscribe from this group|To view this discussion visit|Visit this group at)/;

function splitFromHeader(fromValue) {
  if (!fromValue) return { sender: undefined, senderEmail: undefined };
  const m = fromValue.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { sender: m[1].trim() || undefined, senderEmail: m[2].trim() };
  if (fromValue.includes("@")) return { sender: undefined, senderEmail: fromValue.trim() };
  return { sender: fromValue.trim(), senderEmail: undefined };
}

function stripFooter(body) {
  const lines = body.split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (FOOTER_RE.test(lines[i].trim())) {
      cut = i;
      // Drop a preceding "--" signature separator if present.
      if (cut > 0 && /^--\s*$/.test(lines[cut - 1].trim())) cut -= 1;
      break;
    }
  }
  return lines.slice(0, cut).join("\n");
}

function cleanSnippet(body, max = 400) {
  const text = (body || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

function buildPost(topic, topicUrl, msg) {
  const rawBody = msg.bodyLines.join("\n");
  // Trim leading/trailing separator/blank lines, then strip Google footer.
  const body = stripFooter(rawBody.replace(/^[=\s]+/, "").replace(/[=\s]+$/, "")).trim();
  return {
    topic: (topic || "(no topic)").trim(),
    sender: msg.sender || msg.senderEmail || "(unknown)",
    senderEmail: msg.senderEmail,
    date: msg.date,
    link: msg.url || topicUrl,
    snippet: cleanSnippet(body),
    body,
  };
}

export function parseDigest(digestBody) {
  if (!digestBody || typeof digestBody !== "string") return [];
  const lines = digestBody.replace(/\r/g, "").split("\n");

  const posts = [];
  let currentTopic = null;
  let currentTopicUrl = null;
  let msg = null;

  const flush = () => {
    if (msg) {
      posts.push(buildPost(currentTopic, currentTopicUrl, msg));
      msg = null;
    }
  };

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];

    const topicM = line.match(TOPIC_RE);
    if (topicM) {
      flush();
      currentTopic = topicM[1].trim();
      currentTopicUrl = null;
      const next = lines[idx + 1] || "";
      const um = next.match(URL_RE);
      if (um) currentTopicUrl = um[1];
      continue;
    }

    if (MSG_DELIM_RE.test(line)) {
      flush();
      msg = { sender: null, senderEmail: null, date: null, url: null, bodyLines: [], inHeader: true };
      continue;
    }

    if (!msg) continue; // still in the summary header, before any message

    if (msg.inHeader) {
      const fromM = line.match(FROM_RE);
      if (fromM) {
        const { sender, senderEmail } = splitFromHeader(fromM[1]);
        msg.sender = sender;
        msg.senderEmail = senderEmail;
        continue;
      }
      const dateM = line.match(DATE_RE);
      if (dateM) {
        msg.date = dateM[1].trim();
        continue;
      }
      const urlM = line.match(URL_RE);
      if (urlM) {
        msg.url = urlM[1];
        continue;
      }
      if (line.trim() === "") {
        msg.inHeader = false;
        continue;
      }
      // First non-empty, non-header line ends the header block.
      msg.inHeader = false;
      msg.bodyLines.push(line);
    } else {
      msg.bodyLines.push(line);
    }
  }

  flush();
  return posts;
}

// Run directly (`npm run parse:sample`) to test against files in ./samples.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = path.join(__dirname, "samples");
  if (!fs.existsSync(dir)) {
    console.log("No ./samples directory. Create one and drop saved digest .txt/.eml files in it.");
    process.exit(0);
  }
  const files = fs.readdirSync(dir).filter((f) => /\.(txt|eml)$/i.test(f));
  if (!files.length) {
    console.log("No .txt/.eml files found in ./samples.");
    process.exit(0);
  }
  for (const file of files) {
    const content = fs.readFileSync(path.join(dir, file), "utf8");
    const posts = parseDigest(content);
    console.log(`\n=== ${file}: ${posts.length} post(s) ===`);
    for (const p of posts) {
      console.log(`\n[${p.sender}] ${p.topic}`);
      console.log(`  link: ${p.link || "-"}`);
      console.log(`  snippet: ${p.snippet.slice(0, 160).replace(/\n/g, " ")}`);
    }
  }
}
