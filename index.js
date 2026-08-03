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
  createReferralDraft,
  markAsRead,
  ensureLabel,
  getLabelId,
  addLabel,
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

function loadReferralSheet() {
  const sheetPath = path.resolve(__dirname, config.referralSheet.path);
  if (!fs.existsSync(sheetPath)) {
    log(`WARNING: referral sheet not found at ${sheetPath}; drafts will have no attachment.`);
    return null;
  }
  return {
    filename: config.referralSheet.filename,
    mimeType: "application/pdf",
    content: fs.readFileSync(sheetPath),
  };
}

async function run() {
  log(`Starting triage run. DRY_RUN=${DRY_RUN}. Query="${config.gmailQuery}"`);

  const attachment = loadReferralSheet();
  if (attachment) {
    log(`Attaching referral sheet (${attachment.filename}, ${attachment.content.length} bytes).`);
  }

  const gmail = getGmail();

  // Dedup: exclude anything already labeled as processed. In a real run we
  // create the label (so we can apply it afterward); in dry-run we only use it
  // for exclusion if it already exists, so dry-run never mutates Gmail.
  let processedLabelId = null;
  let query = config.gmailQuery;
  if (config.processedLabel) {
    processedLabelId = DRY_RUN
      ? await getLabelId(gmail, config.processedLabel)
      : await ensureLabel(gmail, config.processedLabel);
    if (processedLabelId) query += ` -label:"${config.processedLabel}"`;
  }

  const messages = await listMessages(gmail, query, config.maxMessages);
  log(`Found ${messages.length} candidate digest message(s). Query="${query}"`);

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

      if (!post.senderEmail) {
        log(`  ! no poster email parsed for "${post.topic}"; skipping draft.`);
        continue;
      }

      try {
        // Standalone draft to the poster (not threaded onto the digest), so each
        // referral shows as its own item in Drafts.
        const draft = await createReferralDraft(gmail, {
          toEmail: post.senderEmail,
          subject: post.topic,
          bodyText: result.draftReply,
          attachment,
        });
        log(
          `  ✓ draft created to ${post.senderEmail} (id=${draft.id}` +
            `${attachment ? ", with referral sheet" : ""}).`
        );
      } catch (err) {
        log(`  ! draft error for "${post.topic}": ${err.message}`);
      }
    }

    if (!DRY_RUN && processedLabelId) {
      try {
        await addLabel(gmail, id, processedLabelId);
        log(`  labeled "${config.processedLabel}" (won't be processed again).`);
      } catch (err) {
        log(`  ! could not apply processed label: ${err.message}`);
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
