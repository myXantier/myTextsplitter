export default {
  translation: {
    language: {
      toggle: 'Sprache wechseln'
    },
    appName: 'Text Splitter',
    tabs: {
      splitter: 'Text Splitter',
      diff: 'Text Vergleich',
      filter: 'Text Filter',
      remove: 'Zeilen Entfernen'
    },
    regex: {
      useRegex: 'Regex-Muster verwenden',
      separator: 'Trennzeichen:',
      placeholderSimple: 'z.B. _',
      placeholderMulti: 'Verwende | für mehrere Trennzeichen (z.B. _|;)',
      history: {
        title: 'Muster-Verlauf',
        noPatterns: 'Keine gespeicherten Muster',
        savePattern: 'Muster speichern',
        usePattern: 'Dieses Muster verwenden',
        removePattern: 'Muster entfernen'
      },
      builder: {
        title: 'Muster-Builder',
        text: 'Text',
        digit: 'Ziffer',
        word: 'Wort',
        space: 'Leerzeichen',
        custom: 'Benutzerdefiniert',
        exactly: 'Genau',
        optional: 'Optional (?)',
        zeroOrMore: 'Null oder mehr (*)',
        oneOrMore: 'Eins oder mehr (+)',
        exactlyN: 'Genau n-mal',
        nOrMore: 'n oder mehr',
        between: 'Zwischen n und m',
        enterValue: 'Wert eingeben...',
        removeBlock: 'Block entfernen',
        applyPattern: 'Muster anwenden',
        hidePreview: 'Vorschau ausblenden',
        showPreview: 'Vorschau anzeigen',
        savePattern: 'Muster speichern'
      },
      tester: {
        title: 'Regex-Muster Test',
        matchesFound: '{{count}} Übereinstimmungen gefunden',
        useCustomText: 'Benutzerdefinierten Text verwenden',
        testPattern: 'Muster testen',
        firstLinePreview: 'Vorschau erste Zeile:',
        empty: '(leer)',
        splitResult: 'Aufspaltungsergebnis:'
      }
    },
    options: {
      title: 'Optionen',
      separatorOptions: 'Trennzeichen-Optionen',
      multipleSeparators: 'Mehrere Trennzeichen',
      textProcessing: 'Textverarbeitung',
      trimLines: 'Zeilen trimmen',
      trimparts: 'Geteilte Teile trimmen',
      displayOptions: 'Anzeigeoptionen',
      showLineNumbers: 'Zeilennummern anzeigen',
      keepEmptyLines: 'Leere Zeilen behalten',
      autoSplit: 'Auto-Split beim Einfügen'
    },
    actions: {
      openFile: 'Datei öffnen',
      splitText: 'Text teilen',
      save: 'Speichern',
      undo: 'Rückgängig',
      redo: 'Wiederherstellen',
      copy: 'Kopieren',
      copied: 'Kopiert',
      clear: 'Löschen'
    },
    columns: {
      dragToReorder: 'Ziehen zum Neuordnen',
      delete: 'Spalte löschen'
    },
    shortcuts: {
      copy: 'Spalte kopieren',
      delete: 'Spalte löschen',
      toggleEdit: 'Bearbeitung umschalten',
      copyHint: 'Strg+C',
      deleteHint: 'Entf',
      editHint: 'Strg+E'
    },
    sourceText: {
      label: 'Quelltext:',
      placeholder: 'Text hier einfügen oder Datei öffnen...',
      dropHere: 'Textdatei hier ablegen'
    },
    combine: {
      title: 'Spalten kombinieren',
      separator: 'Trennzeichen:',
      appendColumn: 'Spalte anhängen:',
      column: 'Spalte {{number}}',
      result: 'Kombiniertes Ergebnis:'
    },
    notifications: {
      copied: 'In die Zwischenablage kopiert!',
      saved: 'Datei erfolgreich gespeichert!',
      fileTooLarge: 'Datei ist zu groß. Maximale Größe ist 10MB.',
      readError: 'Fehler beim Lesen der Datei',
      saveError: 'Fehler beim Speichern der Datei',
      copyError: 'Fehler beim Kopieren in die Zwischenablage',
      invalidRegex: 'Ungültiges Regex-Muster',
      processingError: 'Fehler bei der Verarbeitung'
    },
    errors: {
      textAndPatternRequired: 'Text und Muster sind erforderlich',
      processingTimeout: 'Zeitüberschreitung bei der Verarbeitung',
      processingAborted: 'Verarbeitung wurde abgebrochen',
      processingGeneral: 'Fehler bei der Verarbeitung',
      invalidPattern: 'Ungültiges Muster',
      invalidRegex: 'Ungültiger regulärer Ausdruck',
      fileTooLarge: 'Datei ist zu groß. Maximale Größe ist 10MB.',
      readError: 'Fehler beim Lesen der Datei',
      saveError: 'Fehler beim Speichern der Datei',
      copyError: 'Fehler beim Kopieren in die Zwischenablage',
      processingError: 'Fehler bei der Verarbeitung'
    },
    textDiff: {
      options: {
        trimWhitespace: 'Leerzeichen entfernen',
      },
      oldText: 'Original Text:',
      newText: 'Neuer Text:',
      result: 'Ergebnis:',
      process: 'Zeilen vergleichen',
      oldTextPlaceholder: 'Original Text hier einfügen oder als Datei öffnen...',
      newTextPlaceholder: 'Neuen Text hier einfügen oder als Datei öffnen...',
    },
    removeLines: {
      modes: {
        duplicates: 'Duplikate',
        containing: 'Enthaltend',
        notContaining: 'Nicht Enthaltend'
      },
      options: {
        trim: 'Leerzeichen trimmen',
        caseSensitive: 'Groß-/Kleinschreibung beachten',
        useRegex: 'Regex verwenden'
      },
      sourceText: 'Quelltext:',
      result: 'Ergebnis:',
      process: 'Zeilen Entfernen',
      sourcePlaceholder: 'Text hier einfügen oder Datei öffnen...',
      resultPlaceholder: 'Hier erscheint das Ergebnis...',
      patternPlaceholder: 'Suchtext eingeben...',
      enterPattern: 'Bitte geben Sie einen Suchtext ein',
      processed: '{{removed}} Zeilen wurden entfernt'
    },
    textFilter: {
      modes: {
        remove: 'Treffer Entfernen',
        keep: 'Treffer Behalten'
      },
      options: {
        caseSensitive: 'Groß-/Kleinschreibung beachten',
        splitMatches: 'Treffer in separate Zeilen aufteilen'
      },
      sourceText: 'Quelltext:',
      result: 'Ergebnis:',
      preview: 'Muster-Vorschau:',
      process: 'Text Filtern',
      sourcePlaceholder: 'Text hier einfügen oder Datei öffnen...',
      resultPlaceholder: 'Hier erscheint das Ergebnis...',
      patternPlaceholder: 'Regex-Muster eingeben...',
      enterPattern: 'Bitte geben Sie ein Muster ein',
      processed: 'Text erfolgreich gefiltert',
      noMatches: 'Keine Treffer',
      empty: '(leer)'
    },
    processing: {
      status: {
        processing: 'Verarbeite...'
      },
      mode: {
        backend: 'Backend',
        fallback: 'Frontend',
        auto: 'Auto',
        tooltip: 'Verarbeitungsmodus'
      },
      metrics: {
        time: {
          tooltip: 'Verarbeitungszeit'
        },
        memory: {
          tooltip: 'Speicherverbrauch'
        }
      }
    }
  }
};