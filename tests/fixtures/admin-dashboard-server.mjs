const fixtureRefunds = new Map();
// Isolated browser QA fixture. Never imported by application/runtime services.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
const project = "20000000-0000-4000-8000-000000000001";
const mint = "9o25cywLXMQ2gFM7EynHQer3C7qExxqWw4FJ32Hg2gQa";
const items = Array.from({ length: 26 }, (_, n) => ({
  id: `10000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`,
  order_id: `QA fixture order-${String(n + 1).padStart(2, "0")}`,
  asset: n % 2 ? "USDC" : "USDT",
  cluster: "devnet",
  project_id: project,
  project_name: "QA fixture project",
  status: n % 2 ? "pending" : "paid",
  amount: "1.000000",
  payable_amount: "1.000001",
  created_at: new Date(Date.UTC(2026, 9, 17, 4, n)).toISOString(),
  expires_at: "2026-10-17T06:00:00.000Z",
  invoice_version: 2,
})).reverse();
const projects = [
  {
    id: project,
    name: "QA fixture project",
    environment: "test",
    created_at: "2026-10-17T04:00:00Z",
  },
];
const keys = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    name: "QA legacy backend",
    key_prefix: "zk_test_fixture",
    created_at: "2026-10-17T04:00:00Z",
    revoked_at: null,
  },
];
const reviewTransfers = Array.from({ length: 40 }, (_, n) => ({
  id: String(40 - n),
  signature: `QA-fixture-finalized-signature-${40 - n}`,
  instruction_path: "0",
  slot: "511955651",
  block_time: "2026-10-17T04:00:00Z",
  mint,
  destination: "D5ngDGLnnyAHY8ounFfXVtHbSGGiCMNoK35HV7zQhXAD",
  amount: "0.500000",
  asset: "USDT",
  disposition: n % 2 ? "unmatched" : "partial",
  invoice_id: n % 2 ? null : items[0].id,
  project_id: n % 2 ? null : project,
  project_name: n % 2 ? null : "QA fixture project",
  order_id: n % 2 ? null : "QA review order",
  review_status: "open",
  review_version: 0,
  updated_at: null,
}));
const reviewNotes = [];
const notificationChannels = [
  {
    channel: "telegram",
    enabled: true,
    version: 1,
    config: { chat_id: "-100123456", bot_token_set: true },
  },
];
const notificationLogs = [
  {
    id: "2",
    channel: "telegram",
    status: "sent",
    attempt_count: 1,
    last_error: null,
    sent_at: "2026-10-17T04:00:01Z",
    created_at: "2026-10-17T04:00:00Z",
    expires_at: "2026-10-18T04:00:00Z",
    title: "Pembayaran confirmed",
    event_type: "payment.confirmed",
  },
  {
    id: "1",
    channel: "email",
    status: "waiting_configuration",
    attempt_count: 0,
    last_error: null,
    sent_at: null,
    created_at: "2026-10-17T04:00:00Z",
    expires_at: "2026-10-18T04:00:00Z",
    title: "Pembayaran confirmed",
    event_type: "payment.confirmed",
  },
];
const server = createServer((req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  const send = (data, status = 200) => {
    res.statusCode = status;
    res.end(JSON.stringify(data));
  };
  const url = new URL(req.url, "http://localhost");
  if (!req.headers.cookie?.includes("dashboard_fixture=1"))
    return send({ error: "unauthorized" }, 401);
  if (url.pathname === "/admin/auth/session")
    return send({
      role: req.headers.cookie?.includes("project_admin=1")
        ? "admin"
        : req.headers.cookie?.includes("review_operator=1")
          ? "operator"
          : "read-only",
      permissions: req.headers.cookie?.includes("project_admin=1")
        ? [
            "dashboard:read",
            "project:manage",
            "webhook:replay",
            "review:write",
            "notification:manage",
            "refund:write",
          ]
        : req.headers.cookie?.includes("review_operator=1")
          ? ["dashboard:read", "review:write"]
          : ["dashboard:read"],
      reauthentication_required:
        req.headers.cookie?.includes("project_stale=1") ?? false,
      csrf_token: "fixture-only",
    });
  if (url.pathname === "/admin/notifications")
    return send({
      key_configured: true,
      mailpit_allowed: true,
      channels: notificationChannels,
      items: notificationLogs,
      next_cursor: null,
      worker: {
        scanner_status: "healthy",
        last_success_at: "2026-10-17T04:00:00Z",
        last_error_at: null,
        updated_at: "2026-10-17T04:00:00Z",
      },
    });
  if (
    url.pathname.startsWith("/admin/notifications/") &&
    req.method === "POST"
  ) {
    const parts = url.pathname.split("/"),
      channel = parts[3];
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      if (parts[4] === "test") {
        notificationLogs.unshift({
          ...notificationLogs[0],
          id: String(notificationLogs.length + 1),
          channel,
          status: "pending",
          sent_at: null,
          title: "Uji notifikasi admin",
          event_type: "notification.test",
        });
        return send({ status: "queued" });
      }
      const b = JSON.parse(body),
        old = notificationChannels.find((c) => c.channel === channel),
        config = { ...b.config };
      delete config.password;
      delete config.bot_token;
      config[channel === "email" ? "password_set" : "bot_token_set"] =
        config.mode !== "mailpit";
      const c = {
        channel,
        enabled: b.enabled,
        version: (old?.version ?? 0) + 1,
        config,
      };
      if (old) Object.assign(old, c);
      else notificationChannels.push(c);
      send({ status: "saved" });
    });
    return;
  }
  if (url.pathname === "/admin/monitoring") {
    const run = (id, status) => ({
      id,
      status,
      started_at: "2026-10-17T04:00:00Z",
      finished_at: "2026-10-17T04:00:10Z",
      snapshot_at: "2026-10-17T04:00:00Z",
      invoice_count: "2",
      finding_count: status === "findings" ? "1" : "0",
      chain_checked: status === "unavailable" ? 0 : 2,
      chain_selected: 2,
      chain_complete: status !== "unavailable",
      cursor_start: "0",
      cursor_end: "0",
      cycle_completed: status !== "unavailable",
      error_code: status === "unavailable" ? "chain_unavailable" : null,
    });
    const selected = url.searchParams.get("run_id") ?? "22";
    return send({
      components: ["api", "scanner", "reconciliation"].map((component) => ({
        component,
        status: "healthy",
        reason_code:
          component === "api"
            ? "api_reachable"
            : component === "scanner"
              ? "scanner_current"
              : "reconciliation_clean",
        consecutive_failures: 0,
        last_checked_at: "2026-10-17T04:00:00Z",
        last_success_at: "2026-10-17T04:00:00Z",
        last_alert_at: null,
        recent: true,
      })),
      monitor: {
        started_at: "2026-10-17T04:00:00Z",
        updated_at: "2026-10-17T04:00:00Z",
        recent: !req.headers.cookie?.includes("monitor_stale=1"),
      },
      schedule: {
        next_run_at: "2026-10-17T04:15:00Z",
        cursor_id: "0",
        locked_until: null,
      },
      runs: url.searchParams.has("before_run")
        ? [run("20", "unavailable")]
        : [run("22", "clean"), run("21", "findings")],
      next_cursor: url.searchParams.has("before_run") ? null : "21",
      selected: run(
        selected,
        selected === "21"
          ? "findings"
          : selected === "20"
            ? "unavailable"
            : "clean",
      ),
      findings:
        selected === "21"
          ? [
              {
                code: "ledger_mismatch",
                entity_type: "invoice",
                entity_id: items[0].id,
              },
            ]
          : [],
      samples_truncated: false,
    });
  }
  if (url.pathname === "/admin/transactions") {
    const q = url.searchParams,
      rows = [
        {
          ...reviewTransfers[0],
          id: "41",
          disposition: "paid",
          review_status: null,
        },
        ...reviewTransfers,
      ]
        .map((t) => ({
          ...t,
          cluster: "devnet",
          created_at: t.block_time,
          signature:
            t.id === "40" || t.id === "39" ? "2".repeat(88) : "3".repeat(88),
        }))
        .filter(
          (t) =>
            (!q.get("before") || Number(t.id) < Number(q.get("before"))) &&
            (!q.get("asset") || t.asset === q.get("asset")) &&
            (!q.get("disposition") || t.disposition === q.get("disposition")) &&
            (!q.get("project_id") || t.project_id === q.get("project_id")) &&
            (!q.get("signature") || t.signature === q.get("signature")) &&
            (!q.get("unassigned") || !t.invoice_id),
        );
    return send({
      items: rows.slice(0, 25),
      next_cursor: rows.length > 25 ? rows[24].id : null,
    });
  }
  if (url.pathname === "/admin/reviews") {
    const q = url.searchParams;
    let rows = reviewTransfers.filter(
      (t) =>
        (!q.get("before") || Number(t.id) < Number(q.get("before"))) &&
        (!q.get("disposition") || t.disposition === q.get("disposition")) &&
        (!q.get("project_id") || t.project_id === q.get("project_id")) &&
        (!q.get("asset") || t.asset === q.get("asset")) &&
        ((q.get("status") ?? "active") === "all" ||
          ((q.get("status") ?? "active") === "active"
            ? t.review_status !== "closed"
            : t.review_status === q.get("status"))),
    );
    return send({
      items: rows.slice(0, 25),
      next_cursor: rows.length > 25 ? rows[24].id : null,
    });
  }
  if (url.pathname.startsWith("/admin/reviews/")) {
    const id = url.pathname.split("/")[3],
      transfer = reviewTransfers.find((t) => t.id === id);
    if (!transfer) return send({ error: "not_found" }, 404);
    if (req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const b = JSON.parse(body);
        if (
          req.headers.cookie?.includes("review_conflict=1") ||
          b.expected_version !== transfer.review_version
        )
          return send({ error: "review_changed" }, 409);
        reviewNotes.unshift({
          id: randomUUID(),
          transfer_id: id,
          tenant_id: project,
          object_id: "70000000-0000-4000-8000-000000000001",
          from_status: transfer.review_status,
          to_status: b.status,
          version: transfer.review_version + 1,
          reason: b.reason,
          created_at: new Date().toISOString(),
        });
        transfer.review_status = b.status;
        transfer.review_version++;
        send({ status: b.status, version: transfer.review_version });
      });
      return;
    }
    return send({
      transfer,
      notes: reviewNotes.filter((n) => n.transfer_id === id),
      next_note_cursor: null,
    });
  }
  if (url.pathname === "/admin/projects" && req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const item = {
        id: randomUUID(),
        name: JSON.parse(body).name,
        environment: "test",
        created_at: new Date().toISOString(),
      };
      projects.push(item);
      send(item, 201);
    });
    return;
  }
  if (url.pathname === "/admin/projects") return send({ items: projects });
  if (url.pathname.startsWith("/admin/projects/")) {
    const parts = url.pathname.split("/");
    const item = projects.find((p) => p.id === parts[3]);
    if (!item) return send({ error: "not_found" }, 404);
    if (parts[4] === "webhooks")
      return send({
        configured: true,
        delivery_enabled: false,
        has_more_endpoints: false,
        next_cursor: null,
        endpoints: [
          {
            id: "50000000-0000-4000-8000-000000000001",
            url: "https://merchant.example/webhooks/zekivo",
            kind: "external",
            active: true,
            created_at: "2026-10-17T04:00:00Z",
          },
        ],
        deliveries: [
          {
            id: "17",
            event_id: "60000000-0000-4000-8000-000000000001",
            invoice_id: items[0].id,
            url: "https://merchant.example/webhooks/zekivo",
            event_type: "payment.confirmed",
            status: "dead",
            attempt_count: 3,
            replay_count: 0,
            last_http_status: 503,
            last_error: "http_503",
            next_attempt_at: "2026-10-17T04:00:00Z",
            delivered_at: null,
          },
        ],
      });
    if (parts[4] === "webhook-endpoints" && req.method === "POST")
      return send(
        {
          id: "50000000-0000-4000-8000-000000000001",
          signing_secret: "whsec_fixture-only-not-a-real-secret",
        },
        parts[5] ? 200 : 201,
      );
    if (parts[4] === "webhook-deliveries")
      return send(
        parts[6] === "attempts"
          ? {
              items: [
                {
                  attempt_no: 3,
                  started_at: "2026-10-17T04:00:00Z",
                  finished_at: "2026-10-17T04:00:01Z",
                  http_status: 503,
                  error_code: "http_503",
                },
              ],
            }
          : { status: "replayed" },
      );
    if (parts[4] === "api-keys" && req.method === "POST") {
      if (parts[6] === "revoke") {
        const key = keys.find((k) => k.id === parts[5]);
        if (!key) return send({ error: "not_found" }, 404);
        key.revoked_at = new Date().toISOString();
        return send({ revoked: true });
      }
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const key = {
          id: randomUUID(),
          name: JSON.parse(body).name,
          key_prefix: "zk_test_fixture",
          created_at: new Date().toISOString(),
          revoked_at: null,
          expires_at: null,
          replaces_key_id: parts[6] === "rotate" ? parts[5] : null,
        };
        if (parts[6] === "rotate") {
          const old = keys.find((k) => k.id === parts[5]);
          if (!old) return send({ error: "not_found" }, 404);
          if (old.revoked_at || old.expires_at)
            return send({ error: "key_not_rotatable" }, 409);
          old.expires_at = new Date(
            Date.now() + JSON.parse(body).overlap_hours * 3600000,
          ).toISOString();
        }
        keys.unshift(key);
        send({ ...key, api_key: "zk_test_fixture-only-not-a-real-key" }, 201);
      });
      return;
    }
    return send({
      project: item,
      keys,
      has_more_keys: false,
      next_key_cursor: null,
      invoice_counts: { total: "2", paid: "2" },
    });
  }
  if (url.pathname === "/admin/operations")
    return send({
      environment: "test",
      cluster: "devnet",
      as_of: "2026-10-17T05:00:00Z",
      finalized_head: "511955700",
      rpc: "reachable",
      monitoring: true,
      wallets: ["USDT", "USDC"].map((asset) => ({
        asset,
        mint,
        recipient: "GGQtua3Q7Sdr4K3eCvJA7kiHXCsTCgGBrm7FqoJsPEkk",
        token_account: "D5ngDGLnnyAHY8ounFfXVtHbSGGiCMNoK35HV7zQhXAD",
        balance: "1.000001",
        checkpoint_slot: "511955690",
        checkpoint_updated_at: "2026-10-17T04:59:55Z",
        state: "current",
        lag_slots: "10",
        age_seconds: 5,
      })),
    });
  if (url.pathname === "/admin/overview")
    return send({
      environment: "test",
      cluster: "devnet",
      counts: {
        total: "26",
        paid: "13",
        pending: "13",
        confirming: "0",
        expired: "0",
        review: "0",
      },
      gross_received: [
        { asset: "USDT", amount: "1.000001" },
        { asset: "USDC", amount: "1.000001" },
      ],
      as_of: "2026-10-17T05:00:00Z",
    });
  if (url.pathname === "/admin/invoices") {
    let rows = items.filter((row) =>
      ["status", "asset", "order_id", "project_id"].every(
        (key) =>
          !url.searchParams.get(key) || row[key] === url.searchParams.get(key),
      ),
    );
    const before = url.searchParams.get("before");
    if (before) rows = rows.slice(rows.findIndex((r) => r.id === before) + 1);
    return send({
      items: rows.slice(0, 25),
      next_cursor: rows.length > 25 ? rows[24].id : null,
    });
  }
  if (/^\/admin\/invoices\/[^/]+\/refunds$/.test(url.pathname)) {
    const invoiceId = url.pathname.split("/")[3];
    if (req.method === "POST") {
      let raw = "";
      req.on("data", (chunk) => (raw += chunk));
      req.on("end", () => {
        const body = JSON.parse(raw);
        if (body.signature.startsWith("3"))
          return send({ error: "refund_proof_mismatch" }, 422);
        if (!req.headers.cookie?.includes("project_admin=1"))
          return send({ error: "forbidden" }, 403);
        const rows = fixtureRefunds.get(invoiceId) ?? [];
        rows.unshift({
          ...body,
          id: randomUUID(),
          mint:
            body.asset === "USDC"
              ? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
              : mint,
          source_account: "fixture-treasury-account",
          destination_account: "fixture-destination-account",
          slot: "511955900",
          object_id: "fixture-operator",
          verified_at: new Date().toISOString(),
        });
        fixtureRefunds.set(invoiceId, rows);
        send({ id: rows[0].id, status: "confirmed" }, 201);
      });
      return;
    }
    const rows = fixtureRefunds.get(invoiceId) ?? [];
    return send({
      items: rows,
      totals: rows.length
        ? [{ asset: "USDC", amount: (rows.length * 0.1).toFixed(6) }]
        : [],
      next_cursor: null,
    });
  }
  if (url.pathname.startsWith("/admin/invoices/")) {
    const row = items.find((r) => r.id === url.pathname.split("/").pop());
    if (!row) return send({ error: "not_found" }, 404);
    const history = req.headers.cookie?.includes("history_fixture=1");
    return send({
      invoice: {
        ...row,
        mint,
        recipient: "GGQtua3Q7Sdr4K3eCvJA7kiHXCsTCgGBrm7FqoJsPEkk",
      },
      transfers: [
        {
          id: url.searchParams.has("before_transfer") ? "99" : "100",
          signature: url.searchParams.has("before_transfer")
            ? "2".repeat(64)
            : "1".repeat(64),
          instruction_path: "0",
          slot: "511955651",
          block_time: row.created_at,
          mint,
          asset: row.asset,
          amount: row.payable_amount,
          disposition: "paid",
        },
      ],
      attempts: [
        {
          id: row.id,
          asset: row.asset,
          mint,
          recipient: "GGQtua3Q7Sdr4K3eCvJA7kiHXCsTCgGBrm7FqoJsPEkk",
          payable_amount: row.payable_amount,
          activated_at: row.created_at,
          payment_enabled: true,
        },
      ],
      events: [
        {
          event_id: "30000000-0000-4000-8000-000000000001",
          event_type: url.searchParams.has("before_event")
            ? "fixture.older_event"
            : "payment.confirmed",
          created_at: row.created_at,
        },
      ],
      deliveries: history
        ? [
            {
              id: url.searchParams.has("before_delivery") ? "199" : "200",
              event_id: "30000000-0000-4000-8000-000000000001",
              status: "delivered",
              attempt_count: 1,
              last_http_status: 200,
              last_error: null,
              delivered_at: row.created_at,
            },
          ]
        : [],
      next_cursors: history
        ? {
            transfers: url.searchParams.has("before_transfer") ? null : "100",
            events: url.searchParams.has("before_event")
              ? null
              : "30000000-0000-4000-8000-000000000001",
            deliveries: url.searchParams.has("before_delivery") ? null : "200",
          }
        : undefined,
      has_more: { transfers: false, events: false, deliveries: false },
    });
  }
  send({ error: "not_found" }, 404);
});
server.listen(14101, "127.0.0.1", () =>
  console.log("Dashboard QA fixture API: 127.0.0.1:14101"),
);
