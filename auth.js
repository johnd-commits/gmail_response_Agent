import http from "node:http";
import { URL } from "node:url";
import { exec } from "node:child_process";
import { createOAuth2Client, saveToken, SCOPES } from "./gmailClient.js";
import "dotenv/config";

// One-time OAuth flow for a Desktop app client.
// Spins a tiny loopback server, opens the consent screen, exchanges the code,
// stores the token locally (token.json) and prints the refresh token so you can
// also add it to .env / GitHub Actions secrets as GMAIL_REFRESH_TOKEN.

const PORT = Number(process.env.OAUTH_PORT || 53682);
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "win32"
      ? `start "" "${url}"`
      : platform === "darwin"
        ? `open "${url}"`
        : `xdg-open "${url}"`;
  exec(cmd, (err) => {
    if (err) {
      console.log("\nCould not auto-open a browser. Open this URL manually:\n");
      console.log(url + "\n");
    }
  });
}

async function main() {
  const oauth2 = createOAuth2Client(REDIRECT_URI);

  const authUrl = oauth2.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // force a refresh_token every time
    scope: SCOPES,
  });

  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const url = new URL(req.url, REDIRECT_URI);
        if (url.pathname !== "/oauth2callback") {
          res.writeHead(404).end();
          return;
        }
        const error = url.searchParams.get("error");
        const authCode = url.searchParams.get("code");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<html><body style='font-family:sans-serif'><h2>Authorization complete.</h2>" +
            "<p>You can close this tab and return to the terminal.</p></body></html>"
        );
        server.close();
        if (error) return reject(new Error(`OAuth error: ${error}`));
        if (!authCode) return reject(new Error("No authorization code received."));
        resolve(authCode);
      } catch (e) {
        reject(e);
      }
    });
    server.listen(PORT, () => {
      console.log(`\nListening on ${REDIRECT_URI}`);
      console.log("Opening the Google consent screen in your browser...\n");
      openBrowser(authUrl);
    });
  });

  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);
  saveToken(tokens);

  console.log("\n✅ Authorization successful. Saved to token.json (gitignored).");
  if (tokens.refresh_token) {
    console.log("\nAdd this to your .env (and GitHub Actions secrets) for headless runs:\n");
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}\n`);
  } else {
    console.log(
      "\n⚠️  No refresh_token returned. Revoke prior access at " +
        "https://myaccount.google.com/permissions and re-run `npm run auth`.\n"
    );
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("\nAuth failed:", err.message);
  process.exit(1);
});
