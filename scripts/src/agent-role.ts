import { fileURLToPath } from "node:url";

import { createPool } from "./lib/db.js";

const AGENT_ROLE = "matchi_agent_ro";

// Role DDL cannot take bind parameters, so the password is quoted as a literal.
function quoteLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

async function roleExists(pool: ReturnType<typeof createPool>): Promise<boolean> {
  const { rowCount } = await pool.query("SELECT 1 FROM pg_roles WHERE rolname = $1", [AGENT_ROLE]);
  return (rowCount ?? 0) > 0;
}

export async function setupAgentRole(password: string): Promise<void> {
  const pool = createPool();
  try {
    const verb = (await roleExists(pool)) ? "ALTER" : "CREATE";
    await pool.query(`${verb} ROLE ${AGENT_ROLE} LOGIN PASSWORD ${quoteLiteral(password)}`);
    await pool.query("SELECT grant_agent_read_access()");
    console.log(`${verb === "CREATE" ? "created" : "updated"} role ${AGENT_ROLE}`);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  if (!process.env["DATABASE_URL"]) {
    console.error("DATABASE_URL is not set. Set it to the database that owns the agent schema.");
    process.exit(1);
  }
  const password = process.env["AGENT_DB_PASSWORD"];
  if (!password) {
    console.error(`AGENT_DB_PASSWORD is not set. It becomes the password of ${AGENT_ROLE}.`);
    process.exit(1);
  }

  await setupAgentRole(password);

  const url = new URL(process.env["DATABASE_URL"]);
  url.username = AGENT_ROLE;
  url.password = "";
  console.log(
    `Set AGENT_DATABASE_URL to ${url.href.replace(`${AGENT_ROLE}@`, `${AGENT_ROLE}:<AGENT_DB_PASSWORD>@`)}`,
  );
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
