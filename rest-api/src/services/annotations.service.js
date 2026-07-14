const annoDb = require('../config/annotations-db');
const db = require('../config/database');

/**
 * Annotations-Service — Lese-Overlay + Schreiber für User-Annotationen.
 *
 * Trennt die SCHREIBBARE Sidecar (annotations-db) vom READ_ONLY-Analyse-Stack.
 * Der Lese-Pfad liefert schlanke Maps/Sets, die graph.service über die fertigen
 * Subgraph-/Atlas-Payloads legt (gleiche „weiche Naht" wie enrichCommunities) —
 * die SQL-Templates bleiben annotationsfrei und laufen auch ohne Sidecar.
 */

function esc(v) {
  return String(v).replace(/'/g, "''");
}

/** Composite-Node-Key wie in graph_subgraph.sql (NULL-File ⇒ bare uuid). */
function keyOf(uuid, file) {
  return `${uuid}::${file ?? ''}`;
}

// ── Lese-Overlay ────────────────────────────────────────────────────────────

/**
 * Map aller Community-Annotationen, gekeyt `<engine>|<community>`.
 * Kleine Tabelle (≤ Anzahl benannter Communities) → ein voller Scan genügt.
 */
async function getCommunityAnnotationMap(ctx) {
  if (!annoDb.isAvailable()) return new Map();
  const rows = await annoDb.query(
    ctx,
    `SELECT Engine, Community, User_Name, User_Notes FROM CommunityAnnotation`
  );
  const m = new Map();
  for (const r of rows) {
    m.set(`${r.Engine}|${Number(r.Community)}`, {
      userName: r.User_Name ?? null,
      userNotes: r.User_Notes ?? null,
    });
  }
  return m;
}

/**
 * Set der ausgeblendeten Knoten (`uuid::file`). Die Tabelle hält NUR
 * Hidden-Einträge (sichtbar = Abwesenheit), bleibt also klein.
 */
async function getHiddenKeySet(ctx) {
  if (!annoDb.isAvailable()) return new Set();
  const rows = await annoDb.query(
    ctx,
    `SELECT Object_UUID, File_Name FROM NodeVisibility WHERE Visible = FALSE`
  );
  return new Set(rows.map((r) => keyOf(r.Object_UUID, r.File_Name)));
}

// ── Schreiber ───────────────────────────────────────────────────────────────

/**
 * Community-Name/Notiz setzen (UPSERT auf (Engine, Community)) und den
 * Member-Snapshot für die P4-Offline-Survival neu schreiben.
 * Leere/null-Werte löschen das jeweilige Feld; sind beide leer, wird die
 * Annotation samt Snapshot entfernt.
 */
async function setCommunityAnnotation(ctx, { engine, community, userName, userNotes }) {
  const name = userName && userName.trim() ? userName.trim() : null;
  const notes = userNotes && userNotes.trim() ? userNotes.trim() : null;

  // Bestehende Annotation + Snapshot ersetzen (idempotent).
  await annoDb.run(
    ctx,
    `DELETE FROM CommunityAnnotation WHERE Engine = '${esc(engine)}' AND Community = ${Number(community)}`
  );
  await annoDb.run(
    ctx,
    `DELETE FROM CommunityAnnotationMembers WHERE Engine = '${esc(engine)}' AND Community = ${Number(community)}`
  );

  if (name === null && notes === null) {
    return { engine, community: Number(community), userName: null, userNotes: null, cleared: true };
  }

  await annoDb.run(
    ctx,
    `INSERT INTO CommunityAnnotation (Engine, Community, User_Name, User_Notes)
     VALUES ('${esc(engine)}', ${Number(community)},
             ${name === null ? 'NULL' : `'${esc(name)}'`},
             ${notes === null ? 'NULL' : `'${esc(notes)}'`})`
  );

  // Member-Snapshot aus dem READ_ONLY-Katalog ziehen (nur für P4 nötig).
  await snapshotMembers(ctx, engine, community);

  return { engine, community: Number(community), userName: name, userNotes: notes, cleared: false };
}

/**
 * Member-UUIDs der Community in die Sidecar spiegeln. Best-effort: schlägt das
 * fehl (keine Cluster-Tabellen, Reload), bleibt die Live-Annotation trotzdem
 * gesetzt — nur das Offline-Survival-Votum hat dann keine Basis.
 */
async function snapshotMembers(ctx, engine, community) {
  try {
    const { rows } = await db.executeQuery(
      ctx,
      `SELECT Object_UUID, File_Name FROM ObjectClusters
        WHERE Community = ? AND Engine = ?`,
      [Number(community), engine]
    );
    if (rows.length === 0) return;
    const values = rows
      .map((r) => `('${esc(engine)}', ${Number(community)}, '${esc(r.Object_UUID)}', ${r.File_Name == null ? 'NULL' : `'${esc(r.File_Name)}'`})`)
      .join(',');
    await annoDb.run(
      ctx,
      `INSERT INTO CommunityAnnotationMembers (Engine, Community, Object_UUID, File_Name) VALUES ${values}`
    );
  } catch (err) {
    console.warn(`Community member snapshot skipped: ${err.message}`);
  }
}

/**
 * Node-Sichtbarkeit setzen. visible=true ⇒ Eintrag löschen (Abwesenheit =
 * sichtbar), visible=false ⇒ Hidden-Eintrag schreiben. NULL-File-safe.
 */
async function setNodeVisibility(ctx, { uuid, file, visible }) {
  const fileClause = file == null
    ? `File_Name IS NULL`
    : `File_Name = '${esc(file)}'`;
  await annoDb.run(
    ctx,
    `DELETE FROM NodeVisibility WHERE Object_UUID = '${esc(uuid)}' AND ${fileClause}`
  );
  if (visible === false) {
    await annoDb.run(
      ctx,
      `INSERT INTO NodeVisibility (Object_UUID, File_Name, Visible)
       VALUES ('${esc(uuid)}', ${file == null ? 'NULL' : `'${esc(file)}'`}, FALSE)`
    );
  }
  return { uuid, file: file ?? null, visible: visible !== false };
}

/**
 * Alle ausgeblendeten Knoten mit Anzeige-Metadaten (für die Recovery-Liste im
 * `hide`-Modus). Verschneidet die Sidecar-Keys mit dem READ_ONLY-Katalog.
 */
async function listHidden(ctx) {
  if (!annoDb.isAvailable()) return [];
  const hidden = await annoDb.query(
    ctx,
    `SELECT Object_UUID, File_Name, Updated_At FROM NodeVisibility
      WHERE Visible = FALSE ORDER BY Updated_At DESC`
  );
  if (hidden.length === 0) return [];

  const inList = hidden.map((r) => `'${esc(r.Object_UUID)}'`).join(',');
  let labels = new Map();
  try {
    const { rows } = await db.executeQuery(
      ctx,
      `SELECT Object_UUID, File_Name, Object_Name, Object_Type
         FROM ObjectCatalog WHERE Object_UUID IN (${inList})`
    );
    labels = new Map(rows.map((r) => [keyOf(r.Object_UUID, r.File_Name), r]));
  } catch (err) {
    console.warn(`listHidden label lookup skipped: ${err.message}`);
  }
  return hidden.map((r) => {
    const hit = labels.get(keyOf(r.Object_UUID, r.File_Name));
    return {
      uuid: r.Object_UUID,
      file: r.File_Name ?? null,
      label: hit ? hit.Object_Name : r.Object_UUID,
      type: hit ? hit.Object_Type : null,
    };
  });
}

/**
 * Community-Annotationen nach einem Reload auf die (ggf. neue) Cluster-Partition
 * re-mappen — Objekt-Mehrheitsvotum, identische Mechanik wie cache_apply.sql.
 *
 * Warum nötig: das Live-Overlay keyt auf (Engine, Community). Ein Re-Cluster
 * (fm-graph-cluster) ersetzt ObjectClusters mit NEUEN Community-IDs → die alten
 * (Engine, Community)-Keys zeigen sonst auf inhaltlich andere Communities. Der
 * Member-Snapshot (objekt-genau, stabil) erlaubt, jede Annotation der neuen
 * Community zuzuordnen, deren Member die Mehrheit der Snapshot-Objekte stellen.
 *
 * Idempotent bei unveränderter Partition (jede Community mappt mit purity=coverage=1
 * auf sich selbst). NodeVisibility ist objekt-gekeyt und braucht KEIN Remapping.
 *
 * Läuft im Reload-Hook (system-reload.js) nach db.reload(). No-op ohne Sidecar
 * oder ohne Cluster-Tabellen (Annotationen bleiben dann unangetastet).
 */
const TAU_PURITY = 0.6;
const TAU_COVERAGE = 0.5;

async function remapAfterReload(ctx) {
  if (!annoDb.isAvailable()) return { skipped: 'no-sidecar' };
  const anns = await annoDb.query(
    ctx,
    `SELECT Engine, Community, User_Name, User_Notes FROM CommunityAnnotation`
  );
  if (anns.length === 0) return { remapped: 0, dropped: 0 };

  // Neue aktive Engine bestimmen; ohne Cluster-Tabellen → Annotationen unangetastet.
  let newEngine = '';
  try {
    const r = await db.executeQuery(
      ctx,
      `SELECT Engine FROM ObjectClusters WHERE Engine IS NOT NULL
        GROUP BY Engine ORDER BY COUNT(*) DESC LIMIT 1`
    );
    newEngine = r.rows[0]?.Engine ?? '';
  } catch {
    return { skipped: 'no-clusters' };
  }
  if (!newEngine) return { skipped: 'no-engine' };

  // Pro Annotation: Snapshot-Member gegen die NEUE Partition abstimmen.
  const candidates = [];
  for (const a of anns) {
    const members = await annoDb.query(
      ctx,
      `SELECT Object_UUID, File_Name FROM CommunityAnnotationMembers WHERE Engine = ? AND Community = ?`,
      [a.Engine, Number(a.Community)]
    );
    if (members.length === 0) continue; // kein Snapshot → nicht abstimmbar → fällt raus
    const inList = members.map((m) => `'${esc(m.Object_UUID)}'`).join(',');
    let rows = [];
    try {
      rows = (await db.executeQuery(
        ctx,
        `SELECT Object_UUID, File_Name, Community FROM ObjectClusters
          WHERE Engine = '${esc(newEngine)}' AND Object_UUID IN (${inList})`
      )).rows;
    } catch { continue; }
    const memberKeys = new Set(members.map((m) => keyOf(m.Object_UUID, m.File_Name)));
    const votes = new Map();
    let covered = 0;
    for (const r of rows) {
      if (!memberKeys.has(keyOf(r.Object_UUID, r.File_Name))) continue; // datei-genau
      covered += 1;
      const c = Number(r.Community);
      votes.set(c, (votes.get(c) ?? 0) + 1);
    }
    if (covered === 0) continue;
    let topComm = null;
    let topVotes = 0;
    for (const [c, v] of votes) if (v > topVotes) { topVotes = v; topComm = c; }
    const purity = topVotes / covered;
    const coverage = covered / members.length;
    if (purity >= TAU_PURITY && coverage >= TAU_COVERAGE) {
      candidates.push({ name: a.User_Name, notes: a.User_Notes, newCommunity: topComm, votes: topVotes });
    }
  }

  // 1:1-Constraint: je neuer Community nur der stimmstärkste Kandidat (Split-Schutz).
  const best = new Map();
  for (const c of candidates) {
    const ex = best.get(c.newCommunity);
    if (!ex || c.votes > ex.votes) best.set(c.newCommunity, c);
  }

  // Sidecar neu schreiben: re-gekeyte Annotationen + frische Member-Snapshots.
  await annoDb.run(ctx, `DELETE FROM CommunityAnnotation`);
  await annoDb.run(ctx, `DELETE FROM CommunityAnnotationMembers`);
  let remapped = 0;
  for (const [newComm, c] of best) {
    await annoDb.run(
      ctx,
      `INSERT INTO CommunityAnnotation (Engine, Community, User_Name, User_Notes)
       VALUES ('${esc(newEngine)}', ${newComm},
               ${c.name == null ? 'NULL' : `'${esc(c.name)}'`},
               ${c.notes == null ? 'NULL' : `'${esc(c.notes)}'`})`
    );
    await snapshotMembers(ctx, newEngine, newComm);
    remapped += 1;
  }
  const dropped = anns.length - remapped;
  if (remapped > 0 || dropped > 0) {
    console.log(`Annotations remap after reload: ${remapped} re-keyed, ${dropped} dropped (stale).`);
  }
  return { remapped, dropped, engine: newEngine };
}

// ── R3 — Skill-Namen-Persistenz über Force-Rebuild ───────────────────────────

/**
 * R3-Reload-Hook: Skill-`Semantic_Name`/`Semantic_Description` durabel im Sidecar
 * halten, sodass sie einen Force-Rebuild (`rm master`) überleben — genauso wie die
 * User-Namen es bereits tun. Reihenfolge ist kritisch, sonst überschreibt
 * eine leere Roh-Partition den durablen Cache:
 *
 *   1. RESTORE zuerst: den objekt-granularen `SemanticNameSidecarCache` per
 *      Mehrheitsvotum (identische τ-Mechanik wie die User-Namen) auf die NEUE
 *      ObjectClusters-Partition mappen → `SemanticNameRestore (Engine, Community,…)`.
 *      Greift v. a. nach Force-Rebuild, wenn die Copy keine `Semantic_Name` hat.
 *   2. SNAPSHOT danach, nur wenn sinnvoll: hat die Copy ≥1 `Semantic_Name`
 *      (Master intakt) → Cache aus der Copy frisch befüllen (inkl. Description,
 *      R5). Hat die Copy 0 (Roh-Partition nach Force-Rebuild) → Cache UNANGETASTET
 *      lassen (kein Wipe — sonst gingen die durablen Namen verloren).
 *
 * Läuft vor `remapAfterReload` (User-Namen, Schritt 3). Best-effort, no-op ohne
 * Sidecar/Cluster-Tabellen.
 */
const SEM_TAU_PURITY = 0.6;
const SEM_TAU_COVERAGE = 0.5;

async function restoreSemanticNamesAfterReload(ctx) {
  if (!annoDb.isAvailable()) return { skipped: 'no-sidecar' };

  // Neue aktive Engine (wie remapAfterReload); ohne Cluster-Tabellen → no-op.
  let newEngine = '';
  try {
    const r = await db.executeQuery(
      ctx,
      `SELECT Engine FROM ObjectClusters WHERE Engine IS NOT NULL
        GROUP BY Engine ORDER BY COUNT(*) DESC LIMIT 1`
    );
    newEngine = r.rows[0]?.Engine ?? '';
  } catch {
    return { skipped: 'no-clusters' };
  }
  if (!newEngine) return { skipped: 'no-engine' };

  // ── Schritt 1: durablen Objekt-Cache auf die neue Partition restaurieren. ──
  // Objekte mit gleichem Semantic_Name bildeten eine Community → je Name ein
  // Member-Set, das per Mehrheitsvotum der neuen Community zugeordnet wird.
  const cache = await annoDb.query(
    ctx,
    `SELECT Object_UUID, File_Name, Semantic_Name, Semantic_Description
       FROM SemanticNameSidecarCache WHERE Semantic_Name IS NOT NULL`
  );

  await annoDb.run(ctx, `DELETE FROM SemanticNameRestore`);
  let restored = 0;
  if (cache.length > 0) {
    const groups = new Map(); // Semantic_Name -> { name, desc, members:[{uuid,file}] }
    for (const row of cache) {
      const key = row.Semantic_Name;
      if (!groups.has(key)) {
        groups.set(key, { name: row.Semantic_Name, desc: row.Semantic_Description ?? null, members: [] });
      }
      groups.get(key).members.push({ uuid: row.Object_UUID, file: row.File_Name });
    }

    const candidates = [];
    for (const g of groups.values()) {
      const inList = g.members.map((m) => `'${esc(m.uuid)}'`).join(',');
      let rows = [];
      try {
        rows = (await db.executeQuery(
          ctx,
          `SELECT Object_UUID, File_Name, Community FROM ObjectClusters
            WHERE Engine = '${esc(newEngine)}' AND Object_UUID IN (${inList})`
        )).rows;
      } catch { continue; }
      const memberKeys = new Set(g.members.map((m) => keyOf(m.uuid, m.file)));
      const votes = new Map();
      let covered = 0;
      for (const r of rows) {
        if (!memberKeys.has(keyOf(r.Object_UUID, r.File_Name))) continue; // datei-genau
        covered += 1;
        const c = Number(r.Community);
        votes.set(c, (votes.get(c) ?? 0) + 1);
      }
      if (covered === 0) continue;
      let topComm = null, topVotes = 0;
      for (const [c, v] of votes) if (v > topVotes) { topVotes = v; topComm = c; }
      const purity = topVotes / covered;
      const coverage = covered / g.members.length;
      if (purity >= SEM_TAU_PURITY && coverage >= SEM_TAU_COVERAGE) {
        candidates.push({ name: g.name, desc: g.desc, newCommunity: topComm, votes: topVotes });
      }
    }
    // 1:1-Constraint je neuer Community (Split-Schutz, wie User-Remap).
    const best = new Map();
    for (const c of candidates) {
      const ex = best.get(c.newCommunity);
      if (!ex || c.votes > ex.votes) best.set(c.newCommunity, c);
    }
    for (const [newComm, c] of best) {
      await annoDb.run(
        ctx,
        `INSERT INTO SemanticNameRestore (Engine, Community, Semantic_Name, Semantic_Description)
         VALUES ('${esc(newEngine)}', ${newComm},
                 ${c.name == null ? 'NULL' : `'${esc(c.name)}'`},
                 ${c.desc == null ? 'NULL' : `'${esc(c.desc)}'`})`
      );
      restored += 1;
    }
  }

  // ── Schritt 2: Cache aus der Copy auffrischen — NUR wenn die Copy Namen hat. ──
  let snapshotted = 0;
  try {
    const live = (await db.executeQuery(
      ctx,
      `SELECT oc.Object_UUID, oc.File_Name, cn.Semantic_Name, cn.Semantic_Description, oc.Engine
         FROM ObjectClusters oc
         JOIN CommunityNames cn ON cn.Engine = oc.Engine AND cn.Community = oc.Community
        WHERE cn.Semantic_Name IS NOT NULL`
    )).rows;
    if (live.length > 0) {
      await annoDb.run(ctx, `DELETE FROM SemanticNameSidecarCache`);
      const CHUNK = 1000;
      for (let i = 0; i < live.length; i += CHUNK) {
        const values = live.slice(i, i + CHUNK).map((r) =>
          `('${esc(r.Object_UUID)}', ${r.File_Name == null ? 'NULL' : `'${esc(r.File_Name)}'`}, ` +
          `${r.Semantic_Name == null ? 'NULL' : `'${esc(r.Semantic_Name)}'`}, ` +
          `${r.Semantic_Description == null ? 'NULL' : `'${esc(r.Semantic_Description)}'`}, ` +
          `${r.Engine == null ? 'NULL' : `'${esc(r.Engine)}'`})`
        ).join(',');
        await annoDb.run(
          ctx,
          `INSERT INTO SemanticNameSidecarCache
             (Object_UUID, File_Name, Semantic_Name, Semantic_Description, Engine) VALUES ${values}`
        );
      }
      snapshotted = live.length;
    }
    // Copy hat 0 Semantic_Name → Cache bewusst UNANGETASTET (kein Wipe).
  } catch (err) {
    console.warn(`Semantic-name snapshot skipped: ${err.message}`);
  }

  if (restored > 0 || snapshotted > 0) {
    console.log(`Semantic-name R3 after reload: ${restored} community-names restored, ${snapshotted} objects snapshotted (engine=${newEngine}).`);
  }
  return { restored, snapshotted, engine: newEngine };
}

/**
 * Lese-Overlay für den R3-Restore: Map `<engine>|<community>` →
 * { semanticName, semanticDescription }. Wird vom Coverage-/Graph-Label-Pfad als
 * 3. Namensquelle gelesen (Priorität: User > Copy-Live > Restore > Heuristik).
 */
async function getSemanticRestoreMap(ctx) {
  if (!annoDb.isAvailable()) return new Map();
  const rows = await annoDb.query(
    ctx,
    `SELECT Engine, Community, Semantic_Name, Semantic_Description FROM SemanticNameRestore`
  );
  const m = new Map();
  for (const r of rows) {
    m.set(`${r.Engine}|${Number(r.Community)}`, {
      semanticName: r.Semantic_Name ?? null,
      semanticDescription: r.Semantic_Description ?? null,
    });
  }
  return m;
}

module.exports = {
  getCommunityAnnotationMap,
  getHiddenKeySet,
  setCommunityAnnotation,
  setNodeVisibility,
  listHidden,
  remapAfterReload,
  restoreSemanticNamesAfterReload,
  getSemanticRestoreMap,
};
