/**
 * A fake Apps Script web app that runs on your own computer, for tests.
 *
 * It behaves like the real one, including Google's redirect trick:
 *   1. You POST to the web app URL.
 *   2. It replies "302 Found" and points you at a second URL.
 *   3. fetch follows the redirect with a GET, and that URL has the JSON reply.
 *
 * Tests can also make it misbehave (server errors, slowness, HTML pages)
 * to check that the npm package copes.
 */

import http from "node:http";

/**
 * Starts the fake web app on a random free port.
 *
 * @param {Object} [options]
 * @param {string} [options.secret] - The secret it accepts.
 * @returns {Promise<{ url: string, requests: Array, rows: Array, misbehave: Function, close: Function }>}
 */
export async function startMockServer({ secret = "test-secret" } = {}) {
  const requests = []; // every POST body received (parsed JSON)
  const rows = []; // every row "written to the sheet"
  const plan = []; // misbehaviours for the next requests, used in order
  const replies = new Map(); // replies waiting at the redirect URL
  let nextId = 0;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");

    // The redirect target: hand over the stored reply
    if (url.pathname === "/reply") {
      const reply = replies.get(url.searchParams.get("id"));
      replies.delete(url.searchParams.get("id"));
      res.writeHead(200, { "Content-Type": reply.type });
      res.end(reply.body);
      return;
    }

    const bodyText = await readBody(req);
    const behaviour = plan.shift() ?? "normal";

    // Misbehaviours that happen before any redirect
    if (behaviour === "server_error") {
      res.writeHead(500).end("Internal error");
      return;
    }
    if (behaviour === "rate_limited") {
      res.writeHead(429).end("Too many requests");
      return;
    }
    if (behaviour === "not_found") {
      res.writeHead(404).end("Not found");
      return;
    }
    if (behaviour === "slow") {
      // Never reply in time (the test's timeout will fire first)
      setTimeout(() => res.writeHead(200).end("{}"), 2000).unref();
      return;
    }

    // Work out the reply, then redirect to it (like Google does)
    let reply;
    if (behaviour === "html") {
      reply = { type: "text/html", body: "<html><body>Sign in to continue</body></html>" };
    } else if (behaviour === "busy") {
      reply = jsonReply({ ok: false, error: "busy" });
    } else if (req.method === "GET") {
      reply = jsonReply({ ok: true, name: "sheet-feeder", version: "1.0.0" });
    } else {
      reply = jsonReply(handlePost(bodyText));
    }

    const id = String(nextId++);
    replies.set(id, reply);
    res.writeHead(302, { Location: `/reply?id=${id}` });
    res.end();
  });

  /** The same checks the real Apps Script makes (simplified). */
  function handlePost(bodyText) {
    let body;
    try {
      body = JSON.parse(bodyText);
    } catch {
      return { ok: false, error: "invalid_json" };
    }
    requests.push(body);
    if (body.secret !== secret) return { ok: false, error: "unauthorized" };
    if (!Array.isArray(body.rows)) return { ok: false, error: "invalid_rows" };
    rows.push(...body.rows);
    return { ok: true, added: body.rows.length, sheet: body.sheet ?? "Sheet1" };
  }

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/exec`,
    requests,
    rows,
    /** Queue misbehaviours for the next requests, e.g. misbehave("server_error", "server_error") */
    misbehave(...behaviours) {
      plan.push(...behaviours);
    },
    /** Stops the server. */
    close() {
      server.closeAllConnections();
      return new Promise((resolve) => server.close(resolve));
    },
  };
}

function jsonReply(data) {
  return { type: "application/json", body: JSON.stringify(data) };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let text = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (text += chunk));
    req.on("end", () => resolve(text));
    req.on("error", reject);
  });
}
