# streamify_fm_xml.awk — branch-bewusstes Element-Renaming für den --streamify-Pfad
# der XML-Konvertierung (project/plan_xml_diff_streaming_preprocess.md, Hybrid-Modell).
#
# ZWECK
#   Die `read_xml_objects`-Schwergewichte (LayoutObjects, StepsForScripts, …) lesen
#   heute das GANZE Dokument als DOM (RAM-Blowup). Um sie per webbed-SAX-Streaming zu
#   lesen, braucht read_xml(record_element=…) einen EINDEUTIGEN Anker — generische
#   Namen wie `Layout`/`Script` matchen sonst dokumentweit (Befund §4 Regel 1:
#   record_element='Layout' → 51 statt 14). Dieser Filter benennt die Wiederhol-
#   Elemente NUR innerhalb ihres Ziel-Branches eindeutig um (z. B. LayoutCatalog>Layout
#   → LC_Layout), sodass `record_element='LC_Layout'` exakt die echten Records trifft.
#
# EIGENSCHAFTEN
#   - ZEILEN-STREAMEND, O(n) konstanter Speicher (kein XML-Parser/DOM) — wie
#     tools/split_fm_xml.awk. Setzt dessen Vorverarbeitung voraus (UTF-8, CR→DEL,
#     ein Struktur-Element pro Zeile, TAB-Einrückung nach Tiefe).
#   - BRANCH-BEWUSST: ein Element wird nur umbenannt, wenn sein Ziel-Branch gerade
#     offen ist (Flag, gesetzt bei <Branch …> auf dessen Tiefe, gelöscht bei </Branch>
#     auf derselben Tiefe). Branches verschachteln sich nicht in sich selbst.
#   - PRÄZISE BOUNDARIES: `<Name[ >]` / `</Name>` — `<Layout` matcht NICHT
#     `<LayoutObject`/`<LayoutThemeReference` (dort folgt 'O'/'T'/'R', nicht ' '/'>').
#   - SURGICAL: alle übrigen Bytes bleiben unverändert (Roh-Captures, andere Branches).
#
# REGELN
#   -v rules="Branch:Element:NewName[, …]"  (kommagetrennt). Default unten = alle
#   aktuell unterstützten Schwergewicht-Anker. Beispiel:
#     "LayoutCatalog:Layout:LC_Layout"
#
# Usage: awk -v rules="LayoutCatalog:Layout:LC_Layout" -f streamify_fm_xml.awk < in.xml > out.xml

BEGIN {
    if (rules == "")
        rules = "LayoutCatalog:Layout:LC_Layout"
    nr = split(rules, R, ",")
    for (i = 1; i <= nr; i++) {
        # je Regel: Branch, Element, NewName
        gsub(/^[ \t]+|[ \t]+$/, "", R[i])
        if (R[i] == "") continue
        np = split(R[i], P, ":")
        if (np != 3) { print "streamify_fm_xml.awk: ungültige Regel '" R[i] "'" > "/dev/stderr"; exit 2 }
        rb = P[1]; re = P[2]; rn = P[3]
        rule_branch[++nrules] = rb
        rule_elem[nrules]     = re
        rule_new[nrules]      = rn
    }
}

# Tiefe (führende Tabs) der aktuellen Zeile bestimmen.
function depth_of(line,   d) { d = 0; while (substr(line, d + 1, 1) == "\t") d++; return d }

{
    line = $0
    d = depth_of(line)

    # 1) Branch-CLOSE zuerst: deaktiviert das Flag, BEVOR auf dieser Zeile etwas
    #    umbenannt würde (die Close-Zeile selbst trägt keinen Record-Anker).
    for (i = 1; i <= nrules; i++) {
        b = rule_branch[i]
        if (branch_open[b] && d == branch_depth[b] && line ~ ("^\t*</" b ">[ \t]*$")) {
            branch_open[b] = 0
        }
    }

    # 2) Renaming: für jede Regel, deren Branch gerade offen ist, das Ziel-Element
    #    (Open-/Close-Tag) auf dieser Zeile umbenennen. Präzise Boundaries.
    for (i = 1; i <= nrules; i++) {
        b = rule_branch[i]
        if (!branch_open[b]) continue
        e = rule_elem[i]; nn = rule_new[i]
        # awk-gsub kennt KEINE Backreferences → Boundaries explizit (kein Capture).
        # Open-Tag mit Attributen / self-closing:  "<Elem "  (Leerzeichen grenzt ab,
        #   matcht NICHT <ElemObject/<ElemTheme…). Open-Tag ohne Attribute: "<Elem>".
        #   Close-Tag: "</Elem>".
        gsub("<" e " ",  "<" nn " ",  line)
        gsub("<" e ">",  "<" nn ">",  line)
        gsub("</" e ">", "</" nn ">", line)
    }

    # 3) Branch-OPEN zuletzt: aktiviert das Flag für Folgezeilen (nicht die
    #    Branch-Zeile selbst). Self-closing Branch (<Branch …/>) ignorieren.
    for (i = 1; i <= nrules; i++) {
        b = rule_branch[i]
        if (!branch_open[b] && line ~ ("^\t*<" b "[ >]") && line !~ /\/>[ \t]*$/ && line !~ ("</" b ">[ \t]*$")) {
            branch_open[b] = 1
            branch_depth[b] = d
        }
    }

    print line
}
