import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { gunzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { useAutoCleanupTempDirTracker } from "../../test/helpers/temp-dir.js";
import { requireNodeSqlite } from "../infra/node-sqlite.js";
import { hasPreJournalStateSchema } from "./agent-deletion-journal-history.js";
import { readRetainedAgentDeletionsFromDatabase } from "./agent-deletion-journal.read.js";
import { OPENCLAW_STATE_SCHEMA_SQL } from "./openclaw-state-schema.js";

const tempDirs = useAutoCleanupTempDirTracker(afterEach);

function openReleasedStateDatabase(): DatabaseSync {
  // Shared state written by v2026.7.1-2, before the deletion journal existed.
  const pathname = path.join(tempDirs.make("openclaw-pre-journal-state-"), "openclaw.sqlite");
  fs.writeFileSync(
    pathname,
    gunzipSync(
      fs.readFileSync(
        new URL("../../test/fixtures/sqlite/openclaw-state-v2026.7.1-2.sqlite.gz", import.meta.url),
      ),
    ),
  );
  return new (requireNodeSqlite().DatabaseSync)(pathname);
}

describe("pre-journal shared state deletion history", () => {
  it("reports known-empty history for a released schema-v1 state database", () => {
    const database = openReleasedStateDatabase();
    try {
      expect(hasPreJournalStateSchema(database)).toBe(true);
      expect(readRetainedAgentDeletionsFromDatabase(database)).toEqual([]);
    } finally {
      database.close();
    }
  });

  it("keeps history unavailable once a journal receipt shows the journal existed", () => {
    const database = openReleasedStateDatabase();
    try {
      database.exec("PRAGMA foreign_keys = OFF");
      database
        .prepare(
          `INSERT INTO migration_sources (source_key, migration_kind, source_path, target_table,
             last_run_id, status, imported_at, report_json)
           VALUES ('journal', 'agent-deletion', '/journal', 'agent_deletion_journal',
             'run', 'completed', 1, '{}')`,
        )
        .run();
      expect(hasPreJournalStateSchema(database)).toBe(false);
      expect(readRetainedAgentDeletionsFromDatabase(database)).toBe("unavailable");
    } finally {
      database.close();
    }
  });

  it("keeps history unavailable when a current state database lost its journal", () => {
    const database = new (requireNodeSqlite().DatabaseSync)(":memory:");
    try {
      database.exec(OPENCLAW_STATE_SCHEMA_SQL);
      database.exec("DROP TABLE agent_deletion_journal");
      expect(hasPreJournalStateSchema(database)).toBe(false);
      expect(readRetainedAgentDeletionsFromDatabase(database)).toBe("unavailable");
    } finally {
      database.close();
    }
  });
});
