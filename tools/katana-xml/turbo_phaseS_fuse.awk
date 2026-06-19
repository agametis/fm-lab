# turbo_phaseS_fuse.awk — FUSIONIERTER Phase-S-Pass (plan_xml_diff_streaming_turbo_v3.md, P2.1)
#
# Ersetzt im Turbo-Phase-S-Pfad die bisher GETRENNTEN Voll-Pässe
#   (1) Byte-Clean  (tr -d '\177' | tr '\r' '\177' | tr -d C0)      [preprocess_file]
#   (2) Report-Zähler (wc -c, tr -dc '\r', tr -dc '\177', wc -c)    [preprocess_file]
#   (3) Streamify-Element-Renaming                                  [streamify_fm_xml.awk]
#   (4) Splitter + Chunkmap-Sidecar                                 [split_fm_xml.awk]
# durch EINEN awk-Pass über den iconv-UTF-8-Stream. iconv bleibt als separater
# C-Pass davor (Encoding). Damit fällt Phase S von ~8 auf ~2 Pässe/Datei und die
# Zwischendatei-Round-Trips (_clean.xml schreiben → mv → wieder einlesen) entfallen.
#
# IDENTITÄT (hartes Gate): Output byte-identisch zur alten 3-Pass-Pipeline.
#   - Byte-Clean und die strukturellen Transforms (Rename/Split) sind ORTHOGONAL:
#     Clean berührt nur Steuerbytes (CR/DEL/C0) INNERHALB von CDATA-Inhalt, Rename/
#     Split nur die druckbare Markup-Struktur (<Tag>, TAB-Einrückung). Disjunkte
#     Byte-Klassen → die Reihenfolge clean→rename→split pro Zeile reproduziert exakt
#     die alte Pipeline-Reihenfolge.
#   - LF (0x0A) wird vom Clean NIE verändert (CR→DEL ist 0x0D→0x7F; C0-Strip schließt
#     0x0A/0x09 aus) → die Zeilengrenzen sind vor und nach dem Clean identisch, also
#     liefert per-Zeilen-Clean dasselbe wie der frühere Whole-Stream-`tr`.
#   - MUSS mit LC_ALL=C laufen (byte-transparent, kein Multibyte-Zerschneiden).
#
# Usage: LC_ALL=C awk -v outdir=DIR -v chunkmap=PFAD -v counts=PFAD \
#            [-v rules="Branch:Elem:New,…"] [-v mode=coarse|fine] [-v separate="…"] \
#            [-v subchunk=M] [-v recmap="Branch:RecElem[:M] …"] \
#            -f turbo_phaseS_fuse.awk < utf8_with_bom.xml
#   Schreibt outdir/chunk_000_main.xml + je outdir/chunk_NNN_<branch>.xml, die
#   Chunkmap-TSV nach `chunkmap`, die Zähler-TSV nach `counts`
#   (in_size, out_size, pre_cr, pre_del, pre_stripped) und gibt NCHUNKS auf stdout.
#
# Quellen der gemergten Logik (unverändert in Verhalten, nur fusioniert):
#   tools/split_fm_xml.awk      (Splitter + Chunkmap + Sub-Chunk)
#   tools/streamify_fm_xml.awk  (branch-bewusstes Rename)
#   preprocess_file()           (Byte-Clean + Zähler) in convert_fm_xml.sh

BEGIN {
    # ---- Splitter-Init (identisch zu split_fm_xml.awk) ----
    if (mode == "") mode = "coarse"
    if (separate == "") {
        if (mode == "fine")
            separate = "StepsForScripts DDR_INFO LayoutCatalog FieldsForTables ThemeCatalog"
        else
            separate = "StepsForScripts DDR_INFO"
    }
    k = split(separate, A, " ")
    for (i = 1; i <= k; i++) SEP[A[i]] = 1
    subchunk = (subchunk == "" ? 0 : subchunk + 0)
    if (recmap != "") {
        rk = split(recmap, RM, " ")
        for (i = 1; i <= rk; i++) {
            np = split(RM[i], P, ":")
            REC[P[1]] = P[2]
            if (np >= 3 && P[3] != "") RECM[P[1]] = P[3] + 0
        }
    }
    for (key in REC) {
        em = ((key in RECM) ? RECM[key] : subchunk)
        if (em > 0) SEP[key] = 1
    }
    # NEST (Paket B Tier 1, v4 §3) — identisch zu split_fm_xml.awk: zerlegt einen Tiefe-1-
    # Branch in seine Tiefe-2-Kinder, jedes als eigener Chunk mit Parent-Hülle (DDR_INFO →
    # Calculation-Chunk + Script-Chunk). Format "Parent:Child1,Child2 …". Parent darf NICHT
    # in SEP stehen (sonst 1-Chunk-Separierung) — unten defensiv entfernt.
    if (nest != "") {
        nn_ = split(nest, NG, " ")
        for (i = 1; i <= nn_; i++) {
            ci = index(NG[i], ":")
            if (ci < 2) continue
            np_ = substr(NG[i], 1, ci - 1); nrest = substr(NG[i], ci + 1)
            NESTPAR[np_] = 1
            cc = split(nrest, CH, ",")
            for (j = 1; j <= cc; j++) if (CH[j] != "") NESTOF[np_ SUBSEP CH[j]] = 1
        }
    }
    for (p in NESTPAR) delete SEP[p]
    main = sprintf("%s/chunk_000_main.xml", outdir)
    n = 1
    root = ""; xmldecl = ""
    diverting = 0; curfile = ""; close_re = ""; depth3 = 0
    nestwrap = 0; nestwrap_close = ""
    nest_active = 0; nest_parent = ""; nest_ppad = ""; nest_close_re = ""
    sc_active = 0; sc_rec = ""; sc_recdepth = 0; sc_count = 0
    sc_branchline = ""; sc_pad = ""; sc_tag = ""; sc_M = 0
    sc_nestwrap = 0; sc_nestwrap_open = ""; sc_nestwrap_close = ""
    # DDR-2-Ebenen-Subchunk (Paket B Tier 2, identisch zu split_fm_xml.awk): Records eines
    # NEST-Kindes liegen 2 Ebenen unter der Kindzeile (Child → ObjectList → _<UUID>).
    sc_nest2 = 0; sc_prime = 0; sc_nest_open_block = ""; sc_nest_close_block = ""
    sc_c_open = ""; sc_c_close = ""; sc_p_open = ""; sc_p_close = ""
    ne = 0; cur_entry = 0
    if (chunkmap != "") rec_entry("main", 0, 0, "chunk_000_main.xml")

    # ---- Streamify-Init (identisch zu streamify_fm_xml.awk) ----
    nrules = 0
    if (rules != "") {
        nr = split(rules, R, ",")
        for (i = 1; i <= nr; i++) {
            gsub(/^[ \t]+|[ \t]+$/, "", R[i])
            if (R[i] == "") continue
            np = split(R[i], P, ":")
            if (np != 3) { print "turbo_phaseS_fuse.awk: ungültige Streamify-Regel '" R[i] "'" > "/dev/stderr"; exit 2 }
            rule_branch[++nrules] = P[1]
            rule_elem[nrules]     = P[2]
            rule_new[nrules]      = P[3]
        }
    }

    # ---- Zähler-Init (ersetzt die 4 wc/tr-Pässe in preprocess_file) ----
    in_size = 0; out_size = 0; pre_cr = 0; pre_del = 0
}

# ===== gemeinsame Splitter-Funktionen (aus split_fm_xml.awk) =====
function rec_entry(cat, sn, sm, fn) {
    if (chunkmap == "") return
    ne++
    E_cat[ne] = cat; E_sn[ne] = sn; E_sm[ne] = sm; E_fn[ne] = fn; E_rc[ne] = 0
    cur_entry = ne
}
function next_sn(tag,   v) { v = (tag in SN ? SN[tag] : 0); SN[tag] = v + 1; return v }
function is_record_open(line,   i, rest) {
    i = 0; while (substr(line, i + 1, 1) == "\t") i++
    if (i != sc_recdepth) return 0
    rest = substr(line, i + 1)
    # Namens-agnostischer Modus (Paket B Tier 2, sc_rec=="*"): jedes Element-Open auf
    # Record-Tiefe ist eine Grenze (Close-Tag </…> ausgeschlossen, '/' ∉ [A-Za-z_]).
    if (sc_rec == "*") return (rest ~ /^<[A-Za-z_]/)
    return (rest ~ ("^<" sc_rec "([ >/\t]|$)"))
}
# DDR-2-Ebenen-Wrapper (identisch zu split_fm_xml.awk): erfasst die Record-Parent-Zeile
# (ObjectList, Tiefe sc_recdepth−1) beim ersten Auftreten und baut die Skelettblöcke.
function sc_prime_capture(s,   pd, prest, rptag, rppad) {
    pd = 0; while (substr(s, pd + 1, 1) == "\t") pd++
    if (pd != sc_recdepth - 1) return
    prest = substr(s, pd + 1)
    if (prest !~ /^<[A-Za-z_]/ || prest ~ /\/>[ \t]*$/) return
    rptag = prest; sub(/^</, "", rptag); sub(/[ >\/\t].*/, "", rptag)
    rppad = substr(s, 1, pd)
    sc_nest_open_block  = sc_p_open "\n" sc_c_open "\n" s
    sc_nest_close_block = rppad "</" rptag ">\n" sc_c_close "\n" sc_p_close
    sc_prime = 0
}
function sc_close_current() {
    if (chunkmap != "") E_rc[cur_entry] = sc_count
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

# ===== Streamify-Funktionen (aus streamify_fm_xml.awk), operieren auf global `line` =====
function depth_of(s,   d) { d = 0; while (substr(s, d + 1, 1) == "\t") d++; return d }
function rename_line(   d, i, b, e, nn) {
    d = depth_of(line)
    # 1) Branch-CLOSE zuerst
    for (i = 1; i <= nrules; i++) {
        b = rule_branch[i]
        if (branch_open[b] && d == branch_depth[b] && line ~ ("^\t*</" b ">[ \t]*$")) branch_open[b] = 0
    }
    # 2) Renaming für offene Branches
    for (i = 1; i <= nrules; i++) {
        b = rule_branch[i]
        if (!branch_open[b]) continue
        e = rule_elem[i]; nn = rule_new[i]
        gsub("<" e " ",  "<" nn " ",  line)
        gsub("<" e ">",  "<" nn ">",  line)
        gsub("</" e ">", "</" nn ">", line)
    }
    # 3) Branch-OPEN zuletzt
    for (i = 1; i <= nrules; i++) {
        b = rule_branch[i]
        if (!branch_open[b] && line ~ ("^\t*<" b "[ >]") && line !~ /\/>[ \t]*$/ && line !~ ("</" b ">[ \t]*$")) {
            branch_open[b] = 1; branch_depth[b] = d
        }
    }
}

# ===== Byte-Clean (ersetzt die tr-Pipeline in preprocess_file), operiert auf global `line` =====
# Reihenfolge wie preprocess_file: (c2) DEL-Guard strippen → (b) CR→DEL → (c) C0-Strip.
# Die drei Byte-Klassen sind disjunkt (0x7F ∉ C0-Set, 0x0D vor dem Strip in 0x7F gewandelt),
# daher byte-identisch zur alten 3-fach-`tr`-Kette. BOM-Strip nur auf Zeile 1.
function clean_line(   before) {
    if (NR == 1) sub(/^\357\273\277/, "", line)   # (d) UTF-8-BOM (EF BB BF) strippen
    before = length(line)
    pre_del += gsub(/\177/, "", line)              # (c2) DEL-Guard: 0x7F entfernen
    pre_cr  += gsub(/\r/, "\177", line)            # (b)  CR (0x0D) → DEL (0x7F)
    gsub(/[\000\001-\010\013\014\016-\037]/, "", line)  # (c) XML-1.0-invalide C0-Bytes
    in_size  += before
    out_size += length(line)
}

# ===== Hauptblock: clean → (rename) → Split-Routing, alles auf `line` =====
{
    line = $0
    clean_line()
    if (nrules > 0) rename_line()

    # Root-Tag + optionale XML-Deklaration merken (für die Branch-Skelette)
    if (line ~ /^<\?xml/)           xmldecl = line
    if (line ~ /^<FMSaveAsXML[ >]/) root = line

    # --- Innerhalb eines ausgelagerten Branches: Zeile in den Branch-Chunk streamen ---
    if (diverting) {
        if (sc_active && sc_prime) sc_prime_capture(line)   # DDR: ObjectList-Record-Parent erfassen
        if (sc_active && is_record_open(line)) {
            if (sc_count >= sc_M) { sc_close_current(); sc_open_next(); sc_count = 0 }
            sc_count++
        }
        print line > curfile
        if (line ~ close_re) {
            if (chunkmap != "" && sc_active) E_rc[cur_entry] = sc_count
            if (depth3) { print "\t\t</AddAction>" > curfile; print "\t</Structure>" > curfile }
            else if (nestwrap) { print nestwrap_close > curfile }
            print "</FMSaveAsXML>" > curfile
            close(curfile)
            diverting = 0; curfile = ""; sc_active = 0; sc_nest2 = 0; sc_prime = 0
            nestwrap = 0   # nach NEST-Kind zurück in Parent-Wartezustand
        }
        next
    }

    # --- NEST-Parent-Wartezustand (Paket B Tier 1): zwischen den Tiefe-2-Kindern eines
    #     zerlegten Tiefe-1-Parents (DDR_INFO). Kind-Open → gewrappter Chunk; Parent-Close
    #     → Zustand verlassen. Identisch zu split_fm_xml.awk. ---
    if (nest_active) {
        if (line ~ nest_close_re) { nest_active = 0; next }   # synthetischer Parent-Close
        if (line ~ /^\t\t<[A-Za-z_][A-Za-z0-9_]*/) {
            ctag = line; sub(/^\t+</, "", ctag); sub(/[ >\/].*/, "", ctag)
            if ((nest_parent SUBSEP ctag) in NESTOF) {
                cpad = "\t\t"
                n++
                curfile = sprintf("%s/chunk_%03d_%s.xml", outdir, n, ctag)
                # Effektives Sub-Chunk-M dieses NEST-Kindes (recmap Calculation:*:M / Script:*:M).
                sc_eff_m = ((ctag in RECM) ? RECM[ctag] : subchunk)
                sc_will = (sc_eff_m > 0 && (ctag in REC))
                rec_entry(ctag, next_sn(ctag), (sc_will ? sc_eff_m : 0), sprintf("chunk_%03d_%s.xml", n, ctag))
                if (xmldecl != "") print xmldecl > curfile
                print root > curfile
                print nest_ppad "<" nest_parent ">" > curfile
                print line > curfile
                depth3 = 0; nestwrap = 1; nestwrap_close = nest_ppad "</" nest_parent ">"
                if (line ~ /\/>[ \t]*$/) {                     # self-closing Kind (bei DDR nie)
                    print nestwrap_close > curfile
                    print "</FMSaveAsXML>" > curfile
                    close(curfile); curfile = ""; nestwrap = 0
                    next
                }
                close_re = "^" cpad "</" ctag ">[ \t]*$"
                diverting = 1
                # Tier 2 — DDR-ObjectList-Sub-Chunking (Plan v5 §5/§8.7), identisch zu
                # split_fm_xml.awk: Records 2 Ebenen unter der Kindzeile, sc_recdepth=Kind+2,
                # Record-Parent via sc_prime_capture. Keine Sequence-Spalte → kein seq_offset.
                if (sc_will) {
                    ct = 0; while (substr(line, ct + 1, 1) == "\t") ct++
                    sc_active = 1; sc_nest2 = 1; sc_prime = 1
                    sc_tag = ctag; sc_rec = REC[ctag]
                    sc_recdepth = ct + 2; sc_count = 0; sc_M = sc_eff_m
                    sc_p_open = nest_ppad "<" nest_parent ">"; sc_p_close = nest_ppad "</" nest_parent ">"
                    sc_c_open = line; sc_c_close = cpad "</" ctag ">"
                } else {
                    sc_active = 0; sc_nest2 = 0
                }
                next
            }
        }
        print line > main   # defensiv: bei DDR existiert keine solche Zeile (B.1)
        next
    }

    # --- Branch-Start erkennen: <Name …> an Tiefe-1- ODER Tiefe-3-Position ---
    if (line ~ /^\t(\t\t)?<[A-Za-z_][A-Za-z0-9_]*/) {
        tag = line
        sub(/^\t+</, "", tag); sub(/[ >\/].*/, "", tag)
        # NEST-Parent (Paket B Tier 1): Tiefe-1-Branch in Tiefe-2-Kinder zerlegen.
        if (tag in NESTPAR) {
            if (line ~ /\/>[ \t]*$/) next                 # leerer/self-closing Parent
            t = 0; while (substr(line, t + 1, 1) == "\t") t++
            nest_ppad = ""; for (j = 0; j < t; j++) nest_ppad = nest_ppad "\t"
            nest_active = 1; nest_parent = tag
            nest_close_re = "^" nest_ppad "</" tag ">[ \t]*$"
            next
        }
        if (tag in SEP) {
            t = 0; while (substr(line, t + 1, 1) == "\t") t++
            pad = ""; for (j = 0; j < t; j++) pad = pad "\t"
            depth3 = (t == 3); nestwrap = 0
            n++
            curfile = sprintf("%s/chunk_%03d_%s.xml", outdir, n, tag)
            eff_m = ((tag in RECM) ? RECM[tag] : subchunk)
            will_sub = (eff_m > 0 && (tag in REC))
            rec_entry(tag, next_sn(tag), (will_sub ? eff_m : 0), sprintf("chunk_%03d_%s.xml", n, tag))
            if (xmldecl != "") print xmldecl > curfile
            print root > curfile
            if (depth3) { print "\t<Structure membercount=\"1\">" > curfile; print "\t\t<AddAction membercount=\"1\">" > curfile }
            print line > curfile
            if (line ~ /\/>[ \t]*$/) {                  # self-closing Branch
                if (depth3) { print "\t\t</AddAction>" > curfile; print "\t</Structure>" > curfile }
                print "</FMSaveAsXML>" > curfile
                close(curfile); curfile = ""
                next
            }
            close_re = "^" pad "</" tag ">[ \t]*$"
            diverting = 1
            if (will_sub) {
                sc_active = 1; sc_tag = tag; sc_rec = REC[tag]
                sc_recdepth = t + 1; sc_count = 0; sc_M = eff_m
                sc_branchline = line; sc_pad = pad; sc_depth3 = depth3; sc_nestwrap = 0
            } else {
                sc_active = 0
            }
            next
        }
    }

    # alle übrigen Zeilen → main-Chunk (verbatim, behält die Originalstruktur)
    print line > main
}

END {
    print n
    if (chunkmap != "") {
        for (i = 1; i <= ne; i++)
            printf "%s\t%d\t%d\t%d\t%s\n", E_cat[i], E_sn[i], E_rc[i], E_sm[i], E_fn[i] > chunkmap
        close(chunkmap)
    }
    if (counts != "") {
        printf "%d\t%d\t%d\t%d\t%d\n", in_size, out_size, pre_cr, pre_del, (in_size - out_size) > counts
        close(counts)
    }
}
