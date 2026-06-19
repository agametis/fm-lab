# split_fm_xml.awk — zerteilt eine VORVERARBEITETE FileMaker-SaXML-Datei
# (UTF-8, CR→DEL bereits angewandt) in chunk-Dateien, um den Spitzen-DOM-Speicher
# bei Phase 1 zu senken. project/plan_xml_diff.md §4.5 / plan_xml_postprocessor.md §5.3.
#
# STRATEGIE (Diversions-Modell):
#   Die in der `separate`-Liste genannten Top-Level-Branches werden in EIGENE
#   Chunk-Dateien ausgelagert; der gesamte Rest bleibt im "main"-Chunk.
#   - mode=coarse (Default): separate = "StepsForScripts DDR_INFO" — die beiden
#     schwersten, branch-unabhängigen Sektionen; alle Kataloge bleiben in main.
#   - mode=fine (opt-in): separate += "LayoutCatalog FieldsForTables ThemeCatalog" —
#     die schweren, GUARD-FREIEN Kataloge (Gruppe B, eindeutiger record_element-Name;
#     empirisch spurios-frei, siehe I3.1). Senkt main weiter, ändert aber den
#     RAM-PEAK kaum, wenn ein einzelner Katalog (i.d.R. LayoutCatalog) dominiert —
#     der Peak wird dann vom größten Einzelkatalog gesetzt, nicht von main.
#     (Messreihe: project/plan_xml_diff_finegranular.md §12.)
#
#   Warum NICHT jeden Katalog separieren? webbeds typisiertes
#   `read_xml(root_element='X', record_element='Y')` matcht den record_element
#   GLOBAL, wenn X im Chunk fehlt — z.B. liefert `record_element='ValueList'` dann
#   ValueList-Zugriffsregeln aus PrivilegeSetsCatalog und überschreibt per UPSERT die
#   echten OptionsForValueLists-Zeilen. I3.1 hat das empirisch eingegrenzt: nur
#   OptionsForValueLists leckt Zeilen, die das WHERE überleben (4 Spurios-Zeilen);
#   die schweren Kataloge der fine-Liste sind alle guard-frei. Solange diese drei
#   und die coarse-Branches separiert werden, bleibt das Ergebnis bit-identisch.
#
# PERFORMANCE: Branches werden ZEILENWEISE direkt in die Chunk-Datei gestreamt.
#   (Frühere Versionen pufferten via `buf = buf $0` — String-Konkatenation ist in
#   awk O(n²) und ließ den Splitter auf großen Branches, z.B. einem ~23-MB-
#   StepsForScripts / ~39-MB-LayoutCatalog, praktisch hängen. Auf der kleinen
#   Test-Datei (3,7 MB) war der Effekt mit 2,8 s noch tolerierbar, auf 80 MB nicht
#   mehr. Streaming ist O(n) und auf der Test-Datei coarse bit-identisch zum
#   Puffer-Verfahren.)
#
# Robustheit: FileMaker rückt strukturell mit TABs ein; nach dem Preprocessing liegt
# jeder Calc-CDATA auf EINER LF-Zeile (interne Umbrüche sind DEL), daher beginnt keine
# Inhaltszeile mit exakt n führenden Tabs gefolgt von '<'. Die Branch-Marker sind so
# eindeutig. Das Structure/AddAction-Wrapping richtet sich nach der GEMESSENEN
# Einrücktiefe (t==3 ⇒ Tiefe-3-Katalog), nicht nach dem Namen — robust auch wenn ein
# Katalog unter ModifyAction/ReplaceAction statt AddAction steht (Exploder-Befund D).
# Vollständigkeit (jede Quellzeile genau einem Chunk) sichert der Abnahmetest
# (gesplittet == ungesplittet) im aufrufenden Skript.
#
# SUB-CHUNKING (These 1, project/plan_xml_diff_streaming_optimization.md):
#   Optional werden die SCHWERSTEN separierten Branches zusätzlich INNERHALB des
#   Branches in Stücke von je `subchunk` Records geschnitten — der Peak-DOM-Speicher
#   eines Branches sinkt damit auf ≈ Branchgröße / (Records / subchunk). Jeder
#   Sub-Chunk bleibt ein eigenständiges <FMSaveAsXML>-Dokument MIT vollständiger
#   Branch-/Katalog-Hülle (zwingend für webbeds root_element-Scoping). Die
#   Record-Grenze wird NAMENS-AWARE auf Branch-Tiefe+1 erkannt (recmap: Branch→
#   Record-Element) — Tab-Tiefe ALLEIN genügt nicht, weil manche Kataloge führende
#   Nicht-Record-Geschwister auf derselben Tiefe tragen (LayoutCatalog: <UUID>,
#   <TagList> vor den <Layout>-Records). Korrektheit ist UPSERT-additiv (Records
#   per UUID, reihenfolge-unabhängig); Branches OHNE recmap-Eintrag werden wie
#   bisher nur separiert (kein Sub-Chunk). Verifiziert via Tabellenvergleich
#   gesplittet-mit-Sub-Chunk == gesplittet-ohne (bit-identisch außer FilesCatalog.
#   XML_Path = letzter Chunk-Name + Import_Timestamp — beide variieren bereits beim
#   normalen --split, kein NEUER Divergenzpunkt).
#
#   NICHT sub-chunkbar (empirisch ermittelt — NICHT in recmap aufnehmen):
#   - LayoutCatalog (→Layouts) und ScriptCatalog: ihre Records tragen
#     Sequence_ID = ROW_NUMBER() OVER () in XML-Reihenfolge (KRITISCH für die
#     Folder-Hierarchie). read_xml numeriert jeden Sub-Chunk ab 1 → die globale
#     Sequenz zerbricht (688-Zeilen-Divergenz in Layouts gemessen). LayoutCatalog ist
#     dennoch sub-chunkbar, weil extract.sql den seq_offset aus der Chunkmap addiert.
#   Sicher & sinnvoll: StepsForScripts (schwerster separierter Branch, coarse-
#   Default; Records = <Script> auf Tiefe 4, keine Positionsspalte).
#
#   DDR-2-EBENEN-SUBCHUNK (Tier 2, Plan v5 §5/§8.7): die NEST-Kinder DDR_INFO →
#   Calculation/Script sind sub-chunkbar, OBWOHL ihre Records anonyme UUID-Tag-Namen
#   tragen — der namens-agnostische Anker sc_rec="*" (is_record_open) erkennt jedes
#   Element-Open auf Record-Tiefe (Child→ObjectList→_<UUID>, Tiefe Kind+2). Die Records
#   sitzen 2 Ebenen unter der NEST-Kindzeile, daher rekonstruiert sc_open_next/
#   sc_close_current einen 2-Ebenen-Wrapper (<Parent><Child><ObjectList> …). Identität
#   ist trivial gesichert: DDR_Calculations/DDR_ScriptSteps haben KEINE globale
#   Sequence-Spalte (PK Calc_UUID/Step_UUID, Chunk_Index record-lokal) → kein seq_offset,
#   UPSERT additiv. Aktivierung via recmap "Calculation:*:M Script:*:M".
#
# Usage: awk -v outdir=DIR [-v mode=coarse|fine] [-v separate="..."]
#            [-v subchunk=M] [-v recmap="Branch:RecElem ..."] -f split_fm_xml.awk < cleaned.xml
#        Schreibt outdir/chunk_000_main.xml + je outdir/chunk_NNN_<branch>.xml.
#        Gibt die Zahl erzeugter Chunks auf stdout aus.

BEGIN {
    if (mode == "") mode = "coarse"
    if (separate == "") {
        if (mode == "fine")
            separate = "StepsForScripts DDR_INFO LayoutCatalog FieldsForTables ThemeCatalog"
        else
            separate = "StepsForScripts DDR_INFO"
    }
    k = split(separate, A, " ")
    for (i = 1; i <= k; i++) SEP[A[i]] = 1
    # Sub-Chunk-Konfiguration: subchunk=M (0/leer = aus). recmap mappt Branch→Record-
    # Element; nur gelistete Branches werden sub-gechunkt.
    subchunk = (subchunk == "" ? 0 : subchunk + 0)
    # recmap-Eintrag: "Branch:RecElem" ODER (Turbo, pro-Katalog-M) "Branch:RecElem:M".
    # Fehlt M, gilt das globale `subchunk` als M dieses Branches (rückwärtskompatibel:
    # ein klassischer recmap ohne :M verhält sich exakt wie zuvor).
    if (recmap != "") {
        rk = split(recmap, RM, " ")
        for (i = 1; i <= rk; i++) {
            np = split(RM[i], P, ":")
            REC[P[1]] = P[2]
            if (np >= 3 && P[3] != "") RECM[P[1]] = P[3] + 0
        }
    }
    # NEST (Paket B, v4 §3): zerlegt einen Tiefe-1-Branch in seine Tiefe-2-Kinder, jedes
    # als eigener Chunk MIT Parent-Hülle (z.B. DDR_INFO → Calculation-Chunk + Script-Chunk,
    # Skelett <FMSaveAsXML><DDR_INFO><Calculation>…</Calculation></DDR_INFO></FMSaveAsXML>).
    # Format: "Parent:Child1,Child2 …". Der Parent darf NICHT in SEP stehen (sonst klassische
    # 1-Chunk-Separierung) — BEGIN entfernt ihn defensiv. Die Kinder werden wie normale
    # separierte Branches behandelt (REC/RECM/sub-chunk gelten via Kind-Name als Schlüssel).
    if (nest != "") {
        nn = split(nest, NG, " ")
        for (i = 1; i <= nn; i++) {
            ci = index(NG[i], ":")
            if (ci < 2) continue
            np_ = substr(NG[i], 1, ci - 1); nrest = substr(NG[i], ci + 1)
            NESTPAR[np_] = 1
            cc = split(nrest, CH, ",")
            for (j = 1; j <= cc; j++) if (CH[j] != "") NESTOF[np_ SUBSEP CH[j]] = 1
        }
    }
    # Ein sub-chunkbarer Branch MUSS separiert sein, sonst erreicht er die Sub-Chunk-
    # Logik nie (sie sitzt im branch-start-Block, der nur bei tag in SEP feuert).
    # Effektives M je Branch = RECM[branch] (falls gesetzt) sonst globales subchunk;
    # M>0 ⇒ separieren. Klassik (RECM leer): identisch zu `if (subchunk>0) …`.
    for (key in REC) {
        em = ((key in RECM) ? RECM[key] : subchunk)
        if (em > 0) SEP[key] = 1
    }
    # NEST-Parents dürfen NICHT zugleich klassisch separiert werden (sonst landet der
    # ganze Branch in einem Chunk statt nach Kindern zerlegt). Defensiv aus SEP entfernen.
    for (p in NESTPAR) delete SEP[p]
    main = sprintf("%s/chunk_000_main.xml", outdir)
    n = 1                      # main zählt als Chunk 0; Branch-Chunks ab 1
    root = ""; xmldecl = ""
    diverting = 0; curfile = ""; close_re = ""; depth3 = 0
    nestwrap = 0; nestwrap_close = ""
    nest_active = 0; nest_parent = ""; nest_ppad = ""; nest_close_re = ""
    sc_active = 0; sc_rec = ""; sc_recdepth = 0; sc_count = 0
    sc_branchline = ""; sc_pad = ""; sc_tag = ""; sc_M = 0
    sc_nestwrap = 0; sc_nestwrap_open = ""; sc_nestwrap_close = ""
    # DDR-2-Ebenen-Subchunk (Paket B Tier 2): Records eines NEST-Kindes liegen 2 Ebenen
    # unter der Kindzeile (Child → ObjectList → _<UUID>). sc_nest2 schaltet den 2-Ebenen-
    # Wrapper scharf; sc_prime erfasst die Record-Parent-Zeile (ObjectList) beim ersten Mal.
    sc_nest2 = 0; sc_prime = 0; sc_nest_open_block = ""; sc_nest_close_block = ""
    sc_c_open = ""; sc_c_close = ""; sc_p_open = ""; sc_p_close = ""
    # Chunkmap-Sidecar (Turbo, Phase S): wenn -v chunkmap=PFAD gesetzt ist, sammelt der
    # Splitter je Chunk eine Metadatenzeile und schreibt sie am END nach PFAD (TSV:
    # catalog, split_number, record_count, sub_m, chunk_file). ne = Eintragszahl,
    # cur_entry = aktueller Chunk (record_count-Updates), SN[tag] = GLOBALER Vorkommen-
    # Index dieses Katalogs (0-basiert) = split_number → seq_offset = split_number×M.
    # WICHTIG: SN[tag] zählt über ALLE Chunks eines Katalogs (Sub-Chunks UND mehrfache
    # Branch-Vorkommen) hinweg fort — exakt wie die abgelöste _seqocc-Inline-Schleife,
    # damit Sequence_IDs mehrfach auftretender Kataloge (z.B. LayoutCatalog) nicht
    # kollidieren. Ohne chunkmap-Var: alle rec_entry()-Aufrufe sind No-Ops (Klassik).
    ne = 0; cur_entry = 0
    if (chunkmap != "") rec_entry("main", 0, 0, "chunk_000_main.xml")
}

# Chunkmap-Eintrag anlegen (No-Op ohne chunkmap-Sidecar). Setzt cur_entry auf den
# neuen Eintrag, damit ein späteres record_count-Update den richtigen Chunk trifft.
function rec_entry(cat, sn, sm, fn) {
    if (chunkmap == "") return
    ne++
    E_cat[ne] = cat; E_sn[ne] = sn; E_sm[ne] = sm; E_fn[ne] = fn; E_rc[ne] = 0
    cur_entry = ne
}
# Globaler Vorkommen-Index (0-basiert) je Katalog; pro Chunk dieses Katalogs +1.
function next_sn(tag,   v) { v = (tag in SN ? SN[tag] : 0); SN[tag] = v + 1; return v }

# Ist `line` die Öffnungszeile eines Sub-Chunk-Records (Element sc_rec auf exakt
# sc_recdepth Tabs)? Namens-aware, damit Nicht-Record-Geschwister gleicher Tiefe
# (z.B. <UUID>, <TagList>) keine Grenze auslösen.
function is_record_open(line,   i, rest) {
    i = 0; while (substr(line, i + 1, 1) == "\t") i++
    if (i != sc_recdepth) return 0
    rest = substr(line, i + 1)
    # Namens-agnostischer Modus (Paket B Tier 2, sc_rec=="*"): JEDES Element-Open-Tag auf
    # Record-Tiefe ist eine Record-Grenze (nicht aber ein Close-Tag </…> — '/' ∉ [A-Za-z_]).
    # Sicher NUR dort, wo es keine Nicht-Record-Geschwister gibt (DDR ObjectList: alle Kinder
    # sind _<UUID>-Records, B.1-verifiziert). sc_recdepth-Filter schließt die tieferen
    # Record-Kinder (≥ sc_recdepth+1 Tabs) und den ObjectList-Close (sc_recdepth−1) aus.
    if (sc_rec == "*") return (rest ~ /^<[A-Za-z_]/)
    return (rest ~ ("^<" sc_rec "([ >/\t]|$)"))
}

# DDR-2-Ebenen-Wrapper: erfasst die Record-Parent-Zeile (ObjectList, Tiefe sc_recdepth−1)
# beim ersten Auftreten und baut die Open-/Close-Skelettblöcke (Parent → Child → ObjectList
# bzw. die drei zugehörigen Closes). Self-closing ObjectList (keine Records) wird ignoriert
# — dann findet ohnehin keine Rotation statt und die Blöcke bleiben ungenutzt.
function sc_prime_capture(line,   pd, prest, rptag, rppad) {
    pd = 0; while (substr(line, pd + 1, 1) == "\t") pd++
    if (pd != sc_recdepth - 1) return
    prest = substr(line, pd + 1)
    if (prest !~ /^<[A-Za-z_]/ || prest ~ /\/>[ \t]*$/) return
    rptag = prest; sub(/^</, "", rptag); sub(/[ >\/\t].*/, "", rptag)
    rppad = substr(line, 1, pd)
    sc_nest_open_block  = sc_p_open "\n" sc_c_open "\n" line
    sc_nest_close_block = rppad "</" rptag ">\n" sc_c_close "\n" sc_p_close
    sc_prime = 0
}

# Aktuellen Sub-Chunk schließen (synthetische Branch-/Wrap-/Root-Closes).
function sc_close_current() {
    if (chunkmap != "") E_rc[cur_entry] = sc_count   # Records dieses Sub-Chunks festhalten
    if (sc_nest2) {                                  # DDR: </ObjectList></Child></Parent>
        print sc_nest_close_block > curfile
        print "</FMSaveAsXML>" > curfile
        close(curfile)
        return
    }
    print sc_pad "</" sc_tag ">" > curfile
    if (sc_depth3) { print "\t\t</AddAction>" > curfile; print "\t</Structure>" > curfile }
    else if (sc_nestwrap) { print sc_nestwrap_close > curfile }
    print "</FMSaveAsXML>" > curfile
    close(curfile)
}

# Neuen Sub-Chunk eröffnen (Skelett: xmldecl + root + Wrap + Original-Branchzeile).
function sc_open_next() {
    n++
    curfile = sprintf("%s/chunk_%03d_%s.xml", outdir, n, sc_tag)
    rec_entry(sc_tag, next_sn(sc_tag), sc_M, sprintf("chunk_%03d_%s.xml", n, sc_tag))
    if (xmldecl != "") print xmldecl > curfile
    print root > curfile
    if (sc_nest2) {                                  # DDR: <Parent><Child><ObjectList>
        print sc_nest_open_block > curfile
        return
    }
    if (sc_depth3) { print "\t<Structure membercount=\"1\">" > curfile; print "\t\t<AddAction membercount=\"1\">" > curfile }
    else if (sc_nestwrap) { print sc_nestwrap_open > curfile }
    print sc_branchline > curfile
}

# Root-Tag + optionale XML-Deklaration merken (für die Branch-Skelette)
/^<\?xml/           { xmldecl = $0 }
/^<FMSaveAsXML[ >]/ { root = $0 }

# Innerhalb eines ausgelagerten Branches: Zeile direkt in den Branch-Chunk streamen
# (kein Puffer → O(n)). Close-Marker schließt das eigenständige Dokument ab.
diverting {
    # DDR-2-Ebenen-Subchunk: die erste Element-Open-Zeile auf Record-Tiefe−1 ist der
    # Record-Parent (ObjectList); einmalig erfassen, bevor die Records beginnen.
    if (sc_active && sc_prime) sc_prime_capture($0)
    # Sub-Chunk-Rotation: an einer Record-Grenze (sc_count erreicht subchunk), BEVOR
    # die Zeile geschrieben wird → der neue Record landet vollständig im neuen Chunk
    # (nie mitten in einem Record geschnitten). Die echte Branch-Close-Zeile löst
    # KEINE Rotation aus (is_record_open ist namens-aware auf Record-Tiefe).
    if (sc_active && is_record_open($0)) {
        if (sc_count >= sc_M) { sc_close_current(); sc_open_next(); sc_count = 0 }
        sc_count++
    }
    print $0 > curfile
    if ($0 ~ close_re) {
        if (chunkmap != "" && sc_active) E_rc[cur_entry] = sc_count   # letzter Sub-Chunk
        if (depth3) { print "\t\t</AddAction>" > curfile; print "\t</Structure>" > curfile }
        else if (nestwrap) { print nestwrap_close > curfile }
        print "</FMSaveAsXML>" > curfile
        close(curfile)
        diverting = 0; curfile = ""; sc_active = 0; sc_nest2 = 0; sc_prime = 0
        # nach einem NEST-Kind: zurück in den Parent-Wartezustand (nest_active bleibt 1,
        # bis der Parent-Close kommt). nestwrap zurücksetzen, damit normale Branches frei sind.
        nestwrap = 0
    }
    next
}

# NEST-Parent-Wartezustand (Paket B Tier 1): wir sind zwischen den Tiefe-2-Kindern eines
# zerlegten Tiefe-1-Parents (z.B. DDR_INFO). Erwartet wird entweder ein in NESTOF gelistetes
# Kind-Open (Tiefe 2) → eigener Chunk mit Parent-Hülle, oder der Parent-Close (Tiefe 1) →
# Zustand verlassen. Steht VOR der generischen Branch-Regel; deren Regex (^\t(\t\t)?<)
# trifft Tiefe-2-Zeilen ohnehin nicht. Greift nur außerhalb einer laufenden Diversion.
nest_active && !diverting {
    if ($0 ~ nest_close_re) { nest_active = 0; next }   # synthetischer Parent-Close: verwerfen
    if (match($0, /^\t\t<[A-Za-z_][A-Za-z0-9_]*/)) {
        ctag = $0; sub(/^\t+</, "", ctag); sub(/[ >\/].*/, "", ctag)
        if ((nest_parent SUBSEP ctag) in NESTOF) {
            cpad = "\t\t"
            n++
            curfile = sprintf("%s/chunk_%03d_%s.xml", outdir, n, ctag)
            # Effektives Sub-Chunk-M dieses NEST-Kindes (recmap Calculation:*:M / Script:*:M);
            # fehlt M, gilt das globale subchunk. sc_will ⇒ Tier-2-2-Ebenen-Sub-Chunking.
            sc_eff_m = ((ctag in RECM) ? RECM[ctag] : subchunk)
            sc_will = (sc_eff_m > 0 && (ctag in REC))
            rec_entry(ctag, next_sn(ctag), (sc_will ? sc_eff_m : 0), sprintf("chunk_%03d_%s.xml", n, ctag))
            if (xmldecl != "") print xmldecl > curfile
            print root > curfile
            print nest_ppad "<" nest_parent ">" > curfile   # Parent-Hülle, z.B. "\t<DDR_INFO>"
            print $0 > curfile
            depth3 = 0; nestwrap = 1; nestwrap_close = nest_ppad "</" nest_parent ">"
            if ($0 ~ /\/>[ \t]*$/) {                          # self-closing Kind (bei DDR nie)
                print nestwrap_close > curfile
                print "</FMSaveAsXML>" > curfile
                close(curfile); curfile = ""; nestwrap = 0
                next
            }
            close_re = "^" cpad "</" ctag ">[ \t]*$"
            diverting = 1
            # Tier 2 — DDR-ObjectList-Sub-Chunking (Plan v5 §5/§8.7): Records liegen 2 Ebenen
            # unter der Kindzeile (Child → ObjectList → _<UUID>). sc_recdepth = Kind-Tiefe+2;
            # der ObjectList-Record-Parent wird per sc_prime_capture beim ersten Auftreten
            # erfasst. DDR_Calculations/DDR_ScriptSteps haben KEINE globale Sequence-Spalte
            # (PK Calc_UUID/Step_UUID + record-lokaler Chunk_Index) → kein seq_offset nötig,
            # UPSERT additiv und reihenfolge-unabhängig.
            if (sc_will) {
                ct = 0; while (substr($0, ct + 1, 1) == "\t") ct++
                sc_active = 1; sc_nest2 = 1; sc_prime = 1
                sc_tag = ctag; sc_rec = REC[ctag]
                sc_recdepth = ct + 2; sc_count = 0; sc_M = sc_eff_m
                sc_p_open = nest_ppad "<" nest_parent ">"; sc_p_close = nest_ppad "</" nest_parent ">"
                sc_c_open = $0; sc_c_close = cpad "</" ctag ">"
            } else {
                sc_active = 0; sc_nest2 = 0
            }
            next
        }
    }
    # Sonstige Zeile direkt unter dem Parent — bei DDR_INFO existiert keine (nur Calculation
    # + Script, B.1-verifiziert). Defensiv nach main, damit keine Quellzeile verloren geht.
    print $0 > main
    next
}

# Branch-Start erkennen: <Name …> an einer Tiefe-1- ODER Tiefe-3-Position,
# sofern Name in der separate-Liste steht. (^\t<Name oder ^\t\t\t<Name)
match($0, /^\t(\t\t)?<[A-Za-z_][A-Za-z0-9_]*/) {
    tag = $0
    sub(/^\t+</, "", tag); sub(/[ >\/].*/, "", tag)
    # NEST-Parent (Paket B Tier 1): Tiefe-1-Branch in Tiefe-2-Kinder zerlegen statt als
    # 1 Chunk auslagern. Die Parent-Open-Zeile wird verworfen (je Kind als Hülle neu gebaut).
    if (tag in NESTPAR) {
        if ($0 ~ /\/>[ \t]*$/) next                  # leerer/self-closing Parent → nichts zu tun
        t = 0; while (substr($0, t + 1, 1) == "\t") t++
        nest_ppad = ""; for (j = 0; j < t; j++) nest_ppad = nest_ppad "\t"
        nest_active = 1; nest_parent = tag
        nest_close_re = "^" nest_ppad "</" tag ">[ \t]*$"
        next
    }
    if (tag in SEP) {
        # führende Tabs zählen → korrekt eingerückten Close-Marker + Wrap-Tiefe
        t = 0; while (substr($0, t + 1, 1) == "\t") t++
        pad = ""; for (j = 0; j < t; j++) pad = pad "\t"
        depth3 = (t == 3); nestwrap = 0   # normaler Branch nutzt nie die NEST-Hülle
        # Branch-Chunk eröffnen: eigenständiges <FMSaveAsXML>-Dokument mit Original-Root.
        # Tiefe-3-Kataloge werden in <Structure><AddAction> gewrappt; Tiefe-1-Branches
        # (DDR_INFO) direkt unter <FMSaveAsXML>. //-Pfade in Phase 1 finden beides.
        n++
        curfile = sprintf("%s/chunk_%03d_%s.xml", outdir, n, tag)
        # Effektives Sub-Chunk-M dieses Branches: RECM[tag] (pro-Katalog) || globales
        # subchunk. will_sub = wird dieser Branch sub-gechunkt? (entscheidet Arming +
        # ob der erste Chunk schon ein Sub-Chunk mit sub_m>0 ist).
        eff_m = ((tag in RECM) ? RECM[tag] : subchunk)
        will_sub = (eff_m > 0 && (tag in REC))
        rec_entry(tag, next_sn(tag), (will_sub ? eff_m : 0), sprintf("chunk_%03d_%s.xml", n, tag))
        if (xmldecl != "") print xmldecl > curfile
        print root > curfile
        if (depth3) { print "\t<Structure membercount=\"1\">" > curfile; print "\t\t<AddAction membercount=\"1\">" > curfile }
        print $0 > curfile
        if ($0 ~ /\/>[ \t]*$/) {                       # self-closing Branch
            if (depth3) { print "\t\t</AddAction>" > curfile; print "\t</Structure>" > curfile }
            print "</FMSaveAsXML>" > curfile
            close(curfile); curfile = ""
            next
        }
        close_re = "^" pad "</" tag ">[ \t]*$"
        diverting = 1
        # Sub-Chunking für diesen Branch scharfschalten (nur bei recmap-Eintrag +
        # effektivem M>0). sc_branchline = Original-Branchzeile (Skelett-Nachbau bei
        # jeder Rotation); Records liegen auf Branch-Tiefe+1.
        if (will_sub) {
            sc_active = 1; sc_tag = tag; sc_rec = REC[tag]
            sc_recdepth = t + 1; sc_count = 0; sc_M = eff_m
            sc_branchline = $0; sc_pad = pad; sc_depth3 = depth3; sc_nestwrap = 0
        } else {
            sc_active = 0
        }
        next
    }
}

# alle übrigen Zeilen → main-Chunk (verbatim, behält die Originalstruktur)
{ print $0 > main }

END {
    print n
    # Chunkmap-Sidecar (Turbo, Phase S): eine TSV-Zeile je Chunk in Erzeugungs-
    # Reihenfolge (main zuerst). Spalten: catalog, split_number, record_count, sub_m,
    # chunk_file. seq_offset = split_number×sub_m berechnet der Harness beim Laden.
    if (chunkmap != "") {
        for (i = 1; i <= ne; i++)
            printf "%s\t%d\t%d\t%d\t%s\n", E_cat[i], E_sn[i], E_rc[i], E_sm[i], E_fn[i] > chunkmap
        close(chunkmap)
    }
}
