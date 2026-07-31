import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

import { config } from "./config.js";
import {
  getGmail,
  listMessages,
  getMessage,
  getPlainTextBody,
  getHeader,
  createReplyDraft,
  markAsRead,
} from "./gmailClient.js";
import { parseDigest } from "./digestParser.js";
import { classifyPost } from "./classifier.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const LOG_PATH = path.join(__dirname, "triage.log");

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(stamped);
  fs.appendFileSync(LOG_PATH, stamped + "\n");
}

async function run() {
  log(`Starting triage run. DRY_RUN=${DRY_RUN}. Query="${config.gmailQuery}"`);

  const gmail = getGmail();
  const messages = await listMessages(gmail, config.gmailQuery, config.maxMessages);
  log(`Found ${messages.length} candidate digest message(s).`);

  let matched = 0;
  let skipped = 0;

  for (const { id } of messages) {
    const message = await getMessage(gmail, id);
    const subject = getHeader(message, "Subject") || "(no subject)";
    const body = getPlainTextBody(message);
    const posts = parseDigest(body);
    log(`Digest "${subject}" -> ${posts.length} parsed post(s).`);

    for (const post of posts) {
      let result;
      try {
        result = await classifyPost(post);
      } catch (err) {
        log(`  ! classify error for "${post.topic}": ${err.message}`);
        continue;
      }

      if (!result.matches) {
        skipped++;
        log(`  SKIP  [${post.sender}] "${post.topic}" — ${result.reason}`);
        continue;
      }

      matched++;
      log(`  MATCH [${post.sender}] "${post.topic}" — ${result.reason}`);

      if (DRY_RUN) {
        log(`  (dry-run) would create draft:\n${indent(result.draftReply)}`);
        continue;
      }

      try {
        // Reply into the original digest thread. If you later switch to
        // per-message fetching, target the individual post's message instead.
        const draft = await createReplyDraft(
          gmail,
          message,
          result.draftReply,
          post.senderEmail
        );
        log(`  ✓ draft created (id=${draft.id}).`);
      } catch (err) {
        log(`  ! draft error for "${post.topic}": ${err.message}`);
      }
    }

    if (!DRY_RUN && config.markProcessedRead) {
      try {
        await markAsRead(gmail, id);
        log(`  marked digest as read.`);
      } catch (err) {
        log(`  ! could not mark read: ${err.message}`);
      }
    }
  }

  log(`Done. matched=${matched} skipped=${skipped}.`);
}

function indent(text, pad = "      ") {
  return (text || "")
    .split("\n")
    .map((l) => pad + l)
    .join("\n");
}

run().catch((err) => {
  log(`FATAL: ${err.stack || err.message}`);
  process.exit(1);
});
