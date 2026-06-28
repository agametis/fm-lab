const { DuckDBInstance } = require('@duckdb/node-api');
const fs = require('fs');
const path = require('path');
const environment = require('./environment');

let instance   = null;
let connection = null;
let reloading  = false;
let referenceAttached = false;

async function initialize() {
  if (connection) {
    return connection;
  }

  const dbPath = path.resolve(__dirname, '../../', environment.duckdb.path);
  console.log(`Connecting to DuckDB at: ${dbPath}`);

  instance = await DuckDBInstance.create(dbPath, {
    access_mode: 'READ_ONLY',
    max_memory: environment.duckdb.maxMemory,
    threads: String(environment.duckdb.threads),
  });

  connection = await instance.connect();

  // Scan-heavy analytische Queries (z.B. /api/graph/subgraph: Recursive CTE über
  // ~800k ObjectLinks) sprengen sonst unter dem konservativen max_memory die
  // Buffer-Manager-Pins ("failed to pin block"). Insertion-Order-Erhaltung baut
  // große Zwischenpuffer auf, die wir nicht brauchen — alle Templates ordnen
  // explizit via ORDER BY. Abschalten senkt den Speicher-Peak deutlich (genau die
  // vom DuckDB-OOM-Hinweis empfohlene Maßnahme). Gilt für die ganze Verbindung.
  try {
    const pragma = await connection.prepare('SET preserve_insertion_order = false');
    await pragma.run();
    console.log('  - preserve_insertion_order: false (memory tuning)');
  } catch (err) {
    console.warn(`  - preserve_insertion_order tuning skipped: ${err.message}`);
  }

  // DuckDB-Spill auf das DEDIZIERTE Volume lenken statt neben die DB. DuckDB
  // liest DUCKDB_TEMP_DIR NICHT nativ → ohne dieses SET landet großer Spill in
  // rest-api/db/fm_catalog.duckdb.tmp, also auf dem macOS-Bind-Mount: das flutet
  // die File-Sharing-Schicht (Docker-„injecting event blocked"-Crash-Risiko) und
  // umgeht das eigens angelegte /duckdb_spill-Volume. Guarded: nur wenn die Env
  // gesetzt UND das Verzeichnis vorhanden ist (Nicht-Container → DuckDB-Default).
  const tempDir = process.env.DUCKDB_TEMP_DIR;
  if (tempDir && fs.existsSync(tempDir)) {
    try {
      const esc = (s) => s.replace(/'/g, "''");
      await (await connection.prepare(`SET temp_directory = '${esc(tempDir)}'`)).run();
      console.log(`  - temp_directory: ${tempDir} (spill off the bind mount)`);
      if (process.env.DUCKDB_MAX_TEMP) {
        await (await connection.prepare(`SET max_temp_directory_size = '${esc(process.env.DUCKDB_MAX_TEMP)}'`)).run();
        console.log(`  - max_temp_directory_size: ${process.env.DUCKDB_MAX_TEMP}`);
      }
    } catch (err) {
      console.warn(`  - temp_directory tuning skipped: ${err.message}`);
    }
  }

  console.log('DuckDB connection established successfully (READ_ONLY)');
  console.log(`  - Max Memory: ${environment.duckdb.maxMemory}`);
  console.log(`  - Threads: ${environment.duckdb.threads}`);

  await ensureClusterStubs();
  await attachReferenceDb();

  return connection;
}

/**
 * Cluster-Layer-Stubs (TEMP, leer) anlegen, wenn die DB noch nicht geclustert ist.
 *
 * Die Graph-Atlas-Templates (graph_overview_aggregate/leaf/topology) referenzieren
 * `ObjectClusters`/`CommunityNames` per `LEFT JOIN` — auch für group_dim=file/type.
 * Fehlen die Tabellen (frische convert-xml-DB ohne fm-graph-cluster, oder Cluster-
 * Layer per force-rebuild gewischt), schlägt schon das BINDEN fehl (Catalog Error)
 * und der GESAMTE Atlas bricht ab, nicht nur die Community-Segmentierung.
 *
 * DuckDB erlaubt im READ_ONLY-Modus TEMP-Tabellen (rein In-Memory, kein Schreiben
 * in die Datei). Eine TEMP-Tabelle gleichen Namens wird von unqualifizierten
 * Referenzen aufgelöst → die LEFT JOINs liefern NULL-Community statt zu crashen.
 * So degradiert der Atlas sauber zu „keine Communities" (Frontend schaltet dann
 * auf Datei+Komposition um und dimmt Community/Topologie). Wird die DB später
 * geclustert + neu geladen, existiert die echte Tabelle → der Stub entfällt.
 *
 * Idempotent + reload-fest: läuft nach jedem initialize() auf der frischen
 * Verbindung; nur fehlende Tabellen werden gestubt.
 */
const CLUSTER_STUB_DDL = {
  ObjectClusters: `CREATE TEMP TABLE ObjectClusters (
     Object_UUID VARCHAR, File_Name VARCHAR, Community INTEGER, Engine VARCHAR
   )`,
  CommunityNames: `CREATE TEMP TABLE CommunityNames (
     Community INTEGER, Engine VARCHAR, Member_Count BIGINT,
     Dominant_Type VARCHAR, Dominant_File VARCHAR,
     Top_Member_UUID VARCHAR, Top_Member_Label VARCHAR, Sample_Labels VARCHAR[],
     Heuristic_Name VARCHAR, Semantic_Name VARCHAR, Semantic_Description VARCHAR
   )`,
};

async function ensureClusterStubs() {
  try {
    const result = await executeQuery(
      `SELECT table_name FROM information_schema.tables
        WHERE table_name IN ('ObjectClusters', 'CommunityNames')`
    );
    const present = new Set(result.rows.map((r) => r.table_name));
    for (const [name, ddl] of Object.entries(CLUSTER_STUB_DDL)) {
      if (present.has(name)) continue;
      await (await connection.prepare(ddl)).run();
      console.log(`  - cluster stub created (TEMP, empty): ${name} — DB not clustered yet`);
    }
  } catch (err) {
    // Nie fatal: ohne Stub crasht nur der Atlas (wie bisher), der Rest läuft.
    console.warn(`  - cluster stub setup skipped: ${err.message}`);
  }
}

async function attachReferenceDb() {
  referenceAttached = false;
  const refPath = path.resolve(__dirname, '../../', environment.reference.duckdbPath);
  if (!fs.existsSync(refPath)) {
    console.warn(`Reference-DB not found at ${refPath} — /api/reference endpoints will return 503.`);
    return false;
  }
  // ATTACH erlaubt READ_ONLY-Modus selbst auf einer READ_ONLY-Hauptverbindung
  // (getestet mit DuckDB 1.5.x).
  const escaped = refPath.replace(/'/g, "''");
  const stmt = await connection.prepare(`ATTACH '${escaped}' AS ref (READ_ONLY)`);
  await stmt.run();
  referenceAttached = true;
  console.log(`Reference-DB attached as 'ref' from: ${refPath}`);
  return true;
}

function isReferenceAttached() {
  return referenceAttached;
}

async function reload() {
  if (reloading) {
    throw new Error('Reload already in progress');
  }
  reloading = true;
  try {
    await close();
    await initialize();

    const result = await executeQuery('SELECT COUNT(*) AS c FROM duckdb_tables()');
    const tableCount = result.rows[0]?.c;
    const dbPath = path.resolve(__dirname, '../../', environment.duckdb.path);

    return {
      status: 'reloaded',
      tables: typeof tableCount === 'bigint' ? Number(tableCount) : tableCount,
      path: dbPath,
    };
  } finally {
    reloading = false;
  }
}

function getConnection() {
  if (!connection) {
    throw new Error('Database not initialized. Call initialize() first.');
  }
  return connection;
}

async function executeQuery(sql, params = []) {
  if (!connection) {
    await initialize();
  }

  const startTime = Date.now();

  let stmt = null;
  try {
    stmt = await connection.prepare(sql);
    if (params.length > 0) {
      stmt.bind(params);
    }
    const result = await stmt.run();
    const rows = await result.getRowObjectsJS();

    return {
      rows,
      meta: {
        execution_time_ms: Date.now() - startTime,
        result_count: rows.length,
      },
    };
  } catch (err) {
    console.error('Query execution failed:', err.message);
    console.error('SQL:', sql);
    console.error('Params:', params);
    throw err;
  } finally {
    // Prepared Statement explizit freigeben. @duckdb/node-api hält die native
    // DuckDB-Ressource sonst bis zum GC — unter dem konservativen max_memory
    // akkumulieren scan-schwere Queries (z.B. /api/graph/subgraph) sonst bis
    // "failed to pin block". Die Engine selbst gibt pro Statement frei (im
    // CLI kein Leak); nur die ungeschlossenen Node-Handles stauen sich.
    if (stmt) {
      try { stmt.destroySync(); } catch { /* schon freigegeben / Reload */ }
    }
  }
}

async function close() {
  if (!instance) {
    return;
  }

  try {
    if (connection) {
      connection.disconnectSync();
    }
    instance.closeSync();
    console.log('Database connection closed');
  } catch (err) {
    console.error('Error closing database:', err);
    throw err;
  } finally {
    instance   = null;
    connection = null;
    referenceAttached = false;
  }
}

async function getDatabaseStats() {
  const stats = {};

  try {
    const fs = require('fs');
    const dbPath = path.resolve(__dirname, '../../', environment.duckdb.path);

    if (fs.existsSync(dbPath)) {
      const fileStats = fs.statSync(dbPath);
      stats.size_mb = Math.round((fileStats.size / 1024 / 1024) * 100) / 100;
    } else {
      stats.size_mb = 0;
    }

    const tableResult = await executeQuery(`
      SELECT COUNT(*) as table_count
      FROM duckdb_tables()
    `);
    const tableCount = tableResult.rows[0]?.table_count || 0;
    stats.table_count = typeof tableCount === 'bigint' ? Number(tableCount) : tableCount;

    stats.database_path = path.resolve(__dirname, '../../', environment.duckdb.path);
    stats.connected = !!connection;
    stats.max_memory = environment.duckdb.maxMemory;
    stats.threads = environment.duckdb.threads;
  } catch (error) {
    console.error('Error getting database stats:', error);
  }

  return stats;
}

/**
 * Leichtgewichtige DuckDB-Memory-Probe für das Debug-Session-Log.
 * Summiert duckdb_memory().memory_usage_bytes (Buffer-Manager-Belegung über alle
 * Tags) + meldet die größten Einzel-Tags. Niemals werfen: bei (z.B. OOM-naher)
 * Fehlabfrage liefern wir { error } statt den Aufrufer zu kippen.
 *
 * Achtung: das ist eine ECHTE Extra-Query auf derselben Verbindung — sparsam
 * einsetzen (nur vor/nach einer instrumentierten Query, nicht pro Zeile).
 */
async function probeMemory() {
  if (!connection) return { error: 'no-connection' };
  try {
    const { rows } = await executeQuery(
      `SELECT tag, memory_usage_bytes AS bytes
         FROM duckdb_memory()
        WHERE memory_usage_bytes > 0
        ORDER BY memory_usage_bytes DESC`
    );
    const toNum = (v) => (typeof v === 'bigint' ? Number(v) : Number(v) || 0);
    const total = rows.reduce((s, r) => s + toNum(r.bytes), 0);
    const top = rows.slice(0, 5).map((r) => ({ tag: r.tag, mb: +(toNum(r.bytes) / 1e6).toFixed(1) }));
    return { total_mb: +(total / 1e6).toFixed(1), top };
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = {
  initialize,
  getConnection,
  executeQuery,
  probeMemory,
  close,
  reload,
  getDatabaseStats,
  isReferenceAttached,
};
