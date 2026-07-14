#!/usr/bin/env python3
"""
Parsing-Script für MBS FileMaker Plugin Dokumentation
Extrahiert nur die Ausnahmen (Funktionen wo Prefix ≠ Component)
und erstellt eine vereinfachte CSV mit 2 Spalten: Funktionsname, Component

Ausgabe: reference/mbs_component_exceptions.csv

Usage:
  parse_mbs_components.py [PROJECT_ROOT]

  PROJECT_ROOT kann auch über die Umgebungsvariable PROJECT_ROOT gesetzt werden.
  Fallback: aktuelles Verzeichnis
"""

import re
import csv
import sys
import os
from pathlib import Path
from html.parser import HTMLParser

class MBSFunctionParser(HTMLParser):
    """Parser für MBS HTML-Dokumentation"""

    def __init__(self):
        super().__init__()
        self.function_name = None
        self.components = []
        self.in_h2 = False
        self.in_component_cell = False
        self.next_is_component = False

    def handle_starttag(self, tag, attrs):
        if tag == 'h2':
            self.in_h2 = True
        elif tag == 'td':
            attrs_dict = dict(attrs)
            if attrs_dict.get('class') == 'grau':
                self.next_is_component = True
        elif tag == 'a' and self.next_is_component:
            attrs_dict = dict(attrs)
            href = attrs_dict.get('href', '')
            if href.startswith('component_'):
                # Extrahiere Component-Name aus href="component_Plugin.html"
                component = href.replace('component_', '').replace('.html', '')
                self.components.append(component)

    def handle_endtag(self, tag):
        if tag == 'h2':
            self.in_h2 = False
        elif tag == 'td':
            self.next_is_component = False

    def handle_data(self, data):
        if self.in_h2 and not self.function_name:
            # Erster h2-Tag enthält den Funktionsnamen
            self.function_name = data.strip()

def parse_html_file(file_path):
    """Parst eine einzelne HTML-Datei und gibt Funktionsname und Components zurück"""
    parser = MBSFunctionParser()

    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
            parser.feed(content)

        return parser.function_name, parser.components
    except Exception as e:
        print(f"Fehler beim Parsen von {file_path}: {e}")
        return None, []

def analyze_functions(docs_path):
    """Analysiert alle HTML-Dateien und extrahiert nur die Ausnahmen"""

    exceptions = []
    total_functions = 0
    docs_dir = Path(docs_path)

    # Durchlaufe alle HTML-Dateien
    html_files = sorted(docs_dir.glob('*.html'))
    print(f"Analysiere {len(html_files)} HTML-Dateien...")

    for html_file in html_files:
        function_name, components = parse_html_file(html_file)

        if not function_name:
            continue

        # Ignoriere spezielle Seiten (keine Funktionen)
        if function_name in ['Components', 'All', 'New', 'MacOS', 'Windows']:
            continue

        total_functions += 1

        # Hauptkomponente (erste in der Liste)
        primary_component = components[0] if components else 'Unknown'

        # Überspringe Unknown-Einträge
        if primary_component == 'Unknown':
            continue

        # Prüfe ob es eine Ausnahme ist
        has_dot = '.' in function_name

        if has_dot:
            prefix = function_name.split('.')[0]
            is_exception = (prefix != primary_component)
        else:
            # Funktionen ohne Punkt sind immer Ausnahmen
            is_exception = True

        # Nur Ausnahmen speichern
        if is_exception:
            exceptions.append({
                'Funktionsname': function_name,
                'Component': primary_component
            })

    print(f"Gesamt analysiert: {total_functions} Funktionen")
    print(f"Ausnahmen gefunden: {len(exceptions)}")

    return exceptions

def write_csv(exceptions, output_file):
    """Schreibt Ausnahmen in vereinfachte CSV-Datei (nur 2 Spalten)"""

    if not exceptions:
        print("Keine Ausnahmen zum Schreiben.")
        return

    fieldnames = ['Funktionsname', 'Component']

    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(exceptions)

    print(f"\nAusnahmen-CSV erstellt: {output_file}")
    print(f"Anzahl Ausnahmen: {len(exceptions)}")

    # Statistiken nach Component
    component_counts = {}
    for exc in exceptions:
        comp = exc['Component']
        component_counts[comp] = component_counts.get(comp, 0) + 1

    print(f"\nTop 10 Components mit Ausnahmen:")
    for comp, count in sorted(component_counts.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"  {comp:20} {count:4} Ausnahmen")

if __name__ == '__main__':
    # Bestimme PROJECT_ROOT aus verschiedenen Quellen
    project_root = None

    # 1. Kommandozeilenparameter
    if len(sys.argv) > 1:
        project_root = sys.argv[1]

    # 2. Umgebungsvariable
    elif 'PROJECT_ROOT' in os.environ:
        project_root = os.environ['PROJECT_ROOT']

    # 3. Fallback: aktuelles Verzeichnis
    else:
        project_root = os.getcwd()

    # Konvertiere zu Path-Objekt
    project_root = Path(project_root).resolve()

    # Definiere Pfade relativ zum PROJECT_ROOT
    docs_path = project_root / 'docs' / 'mbs' / 'Documents'
    output_file = project_root / 'reference' / 'mbs_component_exceptions.csv'

    print(f"MBS Component Exceptions Parser")
    print(f"=" * 50)
    print(f"Extrahiert nur Ausnahmen (Prefix ≠ Component)")
    print(f"PROJECT_ROOT: {project_root}")
    print()

    exceptions = analyze_functions(docs_path)
    write_csv(exceptions, output_file)

    print(f"\nFertig! Datei erstellt: {output_file}")
