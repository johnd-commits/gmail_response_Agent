import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Google Groups digests bundle many posts into one email. The exact layout
// varies, so this parser is intentionally heuristic and defensive. Test it
// against real saved digests in ./samples and tune the regexes as needed.
//
// A parsed post looks like:
//   { index, topic, sender, senderEmail, snippet, link, body }

const SEPARATOR_RE = /^[-=_]{20,}\s*$/m;
const MESSAGE_MARKER_RE = /^(?:Message|Msg)\s*[:#]?\s*\d+/im;

function extractHeader(block, name) {
  const re = new RegExp(`^${name}\\s*:\\s*(.+)$`, "im");
  const m = block.match(re);
  return m ? m[1].trim() : undefined;
}

function splitFromHeader(fromValue) {
  if (!fromValue) return { sender: undefined, senderEmail: undefined };
  const m = fromValue.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { sender: m[1].trim() || undefined, senderEmail: m[2].trim() };
  if (fromValue.includes("@")) return { sender: undefined, senderEmail: fromValue.trim() };
  return { sender: fromValue.trim(), senderEmail: undefined };
}

function firstGroupsLink(block) {
  const m = block.match(/https?:\/\/groups\.google\.com\/\S+/i);
  return m ? m[0].replace(/[)>.,]+$/, "") : undefined;
}

function cleanSnippet(body, max = 400) {
  const text = (body || "")
    .split("\n")
    .filter((line) => !/^>/.test(line)) // drop quoted lines
    .join("\n")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? text.slice(0, max).trimEnd() + "…" : text;
}

/**
 * Splits a digest body into blocks that each look like an individual post.
 * Strategy: prefer separator lines; fall back to "Message: N" markers.
 */
function splitIntoBlocks(body) {
  let blocks = body
    .split(SEPARATOR_RE)
    .map((b) => b.trim())
    .filter(Boolean);

  // Keep only blocks that resemble a real post (have From + Subject).
  const looksLikePost = (b) => /^from\s*:/im.test(b) && /^subject\s*:/im.test(b);
  const postBlocks = blocks.filter(looksLikePost);
  if (postBlocks.length) return postBlocks;

  // Fallback: split on "Message: N" markers.
  const byMarker = body
    .split(new RegExp(`(?=${MESSAGE_MARKER_RE.source})`, "im"))
    .map((b) => b.trim())
    .filter((b) => looksLikePost(b));
  return byMarker;
}

function blockToBody(block) {
  // Body is whatever follows the last recognized header line.
  const lines = block.split("\n");
  let lastHeaderIdx = -1;
  const headerRe = /^(from|to|subject|date|message|reply-to|cc)\s*:/i;
  for (let i = 0; i < lines.length; i++) {
    if (headerRe.test(lines[i])) lastHeaderIdx = i;
    else if (lastHeaderIdx >= 0 && lines[i].trim() === "") break;
  }
  return lines.slice(lastHeaderIdx + 1).join("\n").trim();
}

export function parseDigest(digestBody) {
  if (!digestBody || typeof digestBody !== "string") return [];

  const blocks = splitIntoBlocks(digestBody);
  const posts = [];

  blocks.forEach((block, i) => {
    const subject = extractHeader(block, "Subject");
    const from = extractHeader(block, "From");
    if (!subject && !from) return;

    const { sender, senderEmail } = splitFromHeader(from);
    const body = blockToBody(block);

    posts.push({
      index: i + 1,
      topic: subject || "(no subject)",
      sender: sender || senderEmail || "(unknown)",
      senderEmail,
      link: firstGroupsLink(block),
      snippet: cleanSnippet(body),
      body,
    });
  });

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
      console.log(`\n#${p.index} [${p.sender}] ${p.topic}`);
      console.log(`  link: ${p.link || "-"}`);
      console.log(`  snippet: ${p.snippet.slice(0, 160).replace(/\n/g, " ")}`);
    }
  }
}
