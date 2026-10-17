export default {
  translation: {
    language: {
      toggle: 'Sprache wechseln'
    },
    appName: 'Text Splitter',
    'Edit Column': 'Spalte bearbeiten',
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
      fileTooLarge: 'Die Datei ist zu groß: höchstens 10 MiB sind erlaubt.',
      readError: 'Fehler beim Lesen der Datei',
      fileLoading: 'Datei wird geladen …',
      unsupportedFileType: 'Nur Textdateien mit der Endung .txt werden unterstützt.',
      invalidEncoding: 'Die Datei ist kein gültiger Text in UTF-8 oder UTF-16 mit BOM und wurde nicht geladen.',
      noFileDropped: 'Es wurde keine Datei abgelegt.',
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
      invalidRegex: 'Ungültige Syntax im regulären Ausdruck',
      patternEmpty: 'Das Regex-Muster darf nicht leer sein (Leerzeichen sind erlaubt).',
      patternTooLong: 'Das Regex-Muster ist zu lang: höchstens 10.000 UTF-16-Codeeinheiten sind erlaubt (ein Emoji zählt meist als 2).',
      regexTooComplex: 'Regulärer Ausdruck ist für diesen Text zu aufwendig',
      invalidMode: 'Unbekannter Verarbeitungsmodus. Bitte eine der angebotenen Aktionen verwenden.',
      regexSplitsCharacter: 'Das Muster trifft nur einen Teil eines Zeichens (z. B. eines Emojis). Das Ergebnis wäre beschädigt und wurde nicht übernommen.',
      emptyDelimiter: 'Das Trennzeichen darf nicht leer sein. Bitte ein Trennzeichen eingeben (Leerzeichen sind erlaubt).',
      diffTooComplex: 'Der Vergleich ist zu aufwendig (zu viele umgestellte Zeilen)',
      regexRequiresWorker: 'Reguläre Ausdrücke können ohne Web Worker nicht sicher ausgeführt werden',
      sortRequiresWorker: 'Dieser Text ist zu groß, um ohne Web Worker sortiert zu werden (die Seite würde einfrieren)',
      processingSuperseded: 'Verarbeitung wurde durch eine neuere ersetzt',
      fileTooLarge: 'Datei ist zu groß. Maximale Größe ist 10MB.',
      readError: 'Fehler beim Lesen der Datei',
      saveError: 'Fehler beim Speichern der Datei',
      copyError: 'Fehler beim Kopieren in die Zwischenablage',
      processingError: 'Fehler bei der Verarbeitung',
      textRequired: 'Bitte geben Sie einen Text ein'
    },
    textDiff: {
      options: {
        trimWhitespace: 'Leerzeichen ignorieren',
        lineNumbers: 'Zeilennummern',
        wordDiff: 'Wort-Hervorhebung',
        title: 'VERGLEICHSOPTIONEN',
        hint: 'Legt fest, wie die Texte verglichen und angezeigt werden',
      },
      view: {
        label: 'Ansicht:',
        unified: 'Einspaltig',
        split: 'Nebeneinander',
      },
      legend: {
        added: 'Hinzugefügt',
        removed: 'Entfernt',
        moved: 'Verschoben',
        changed: 'Geänderte Wörter',
      },
      stats: {
        unchanged: '{{count}} unverändert',
        added: '{{count}} hinzugefügt',
        removed: '{{count}} entfernt',
        moved: '{{count}} verschoben',
        changedPairs_one: '{{count}} geändertes Zeilenpaar (in hinzugefügt/entfernt enthalten)',
        changedPairs_other: '{{count}} geänderte Zeilenpaare (in hinzugefügt/entfernt enthalten)',
      },
      movedTo: 'verschoben nach Zeile {{line}}',
      movedFrom: 'verschoben von Zeile {{line}}',
      wordDiffSkipped: 'Wort-Hervorhebung für {{count}} Zeilen ausgelassen',
      skipReasons: {
        lineTooLong: 'Zeile zu lang',
        hunkTooLarge: 'zu viele geänderte Zeilen am Stück',
        budgetExceeded: 'Rechenbudget erschöpft',
        tooComplex: 'Zeilenpaar zu komplex',
      },
      rowsShown: '{{shown}} von {{total}} Zeilen angezeigt',
      showMore: 'Weitere {{count}} Zeilen anzeigen',
      oldText: 'Original Text:',
      newText: 'Neuer Text:',
      result: 'Ergebnis:',
      process: 'Zeilen vergleichen',
      oldTextPlaceholder: 'Original Text hier einfügen oder als Datei öffnen...',
      newTextPlaceholder: 'Neuen Text hier einfügen oder als Datei öffnen...',
      processed: 'Texte erfolgreich verglichen',
      emptyLine: '(leere Zeile)',
    },
    removeLines: {
      modes: {
        duplicates: 'Duplikate',
        containing: 'Enthaltend',
        notContaining: 'Nicht Enthaltend'
      },
      options: {
        trim: 'Leerzeichen trimmen (nur Duplikate)',
        trimHint: 'Wirkt nur bei „Duplikate“: Zeilen werden ohne führende und abschließende Leerzeichen verglichen, ausgegeben wird immer die Originalzeile. „Enthaltend“ und „Nicht Enthaltend“ ignorieren diese Option.',
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
    sortText: {
      methods: {
        alphabetical: 'Alphabetisch (A bis Z)',
        alphabeticalReverse: 'Alphabetisch (Z bis A)',
        natural: 'Natürlich',
        naturalReverse: 'Natürlich absteigend',
        lengthAsc: 'Zeilenlänge (kürzeste zuerst)',
        lengthDesc: 'Zeilenlänge (längste zuerst)',
        random: 'Zufällig mischen',
      },
      options: {
        title: 'SORTIEROPTIONEN',
        hint: 'Legen Sie fest, wie der Text sortiert wird',
        method: 'Sortiermethode',
        caseSensitive: 'Groß-/Kleinschreibung beachten',
        caseSensitiveHint: 'Gilt nur für alphabetische und natürliche Sortierung; Zeilenlänge und Zufall beachten sie nicht.',
      },
      process: 'Text sortieren',
      sorting: 'Sortiere...',
      result: 'SORTIERERGEBNIS',
      resultPlaceholder: 'Hier erscheint der sortierte Text...',
      resultFor: '{{method}}, {{lines}} Zeilen',
      resultForCase: '{{method}}, {{case}}, {{lines}} Zeilen',
      caseSensitive: 'mit Groß-/Kleinschreibung',
      caseInsensitive: 'ohne Groß-/Kleinschreibung',
      outdated: 'Veraltet: Text oder Optionen wurden seit diesem Ergebnis geändert. Erneut sortieren, um es zu aktualisieren.',
      processed: '{{lines}} Zeilen sortiert',
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
      previewNotes: {
        jsEngine: 'Die Vorschau verwendet JavaScript-RegExp, der Filter im Rust-Modus aber Rust (fancy-regex). Treffer und gültige Muster können sich unterscheiden.',
        notSupportedByJs: 'Keine Vorschau: JavaScript unterstützt dieses Muster nicht. Die Rust-Verarbeitung prüft es selbst.',
        tooComplex: 'Vorschau abgebrochen: Das Muster ist für diesen Text zu aufwendig',
        splitsCharacter: 'Keine Vorschau: Das Muster trifft nur einen Teil eines Zeichens (z. B. eines Emojis). Der Filter würde diesen Text ablehnen.',
        keepSplitCutsCharacter: 'Hinweis: Einige Markierungen setzen ein Zeichen (z. B. ein Emoji) aus zwei Treffern zusammen. „Treffer Behalten“ mit „Treffer in separate Zeilen aufteilen“ würde es trennen und wird abgelehnt; „Treffer Entfernen“ und Behalten ohne Aufteilen funktionieren.',
        // Rust mode: the surrogate verdict comes from the JS RegExp of the preview, not from the Rust Filter
        splitsCharacterRust: 'Keine Vorschau: JavaScript-RegExp trifft mit diesem Muster nur einen Teil eines Zeichens (z. B. eines Emojis), daher kann die Vorschau die Treffer nicht sicher darstellen. Das betrifft die JavaScript-Vorschau: Der Filter im Rust-Modus wertet das Muster mit seiner eigenen Engine aus und kann es anders interpretieren.',
        keepSplitCutsCharacterRust: 'Hinweis: JavaScript-RegExp trifft hier Teile eines Zeichens (z. B. eines Emojis); die Vorschau fügt sie zu einer Markierung zusammen. Die Einschränkung für „Treffer Behalten“ mit „Treffer in separate Zeilen aufteilen“ gilt im JavaScript-Modus. Der Filter im Rust-Modus wertet das Muster mit seiner eigenen Engine aus und kann es anders interpretieren.',
        incomplete: 'Vorschau unvollständig: Sie zeigt höchstens {{rows}} Zeilen, {{matchesPerRow}} Treffer pro Zeile und gekürzten Text. Weitere Treffer sind möglich.',
      },
      previewInfo: {
        summary_one: '{{matches}} Treffer in {{count}} Zeile',
        summary_other: '{{matches}} Treffer in {{count}} Zeilen',
        summaryIncomplete_one: 'mindestens {{matches}} Treffer in {{count}} Zeile (Vorschau begrenzt)',
        summaryIncomplete_other: 'mindestens {{matches}} Treffer in {{count}} Zeilen (Vorschau begrenzt)',
        position: 'Zeile {{line}} ({{current}} / {{total}})',
        noMatches: 'Keine Treffer',
        matchesOnly: 'Die Vorschau zeigt Regex-Treffer, nicht das Filterergebnis. Die Verarbeitung hängt von der gewählten Aktion ab.',
        elided: ' … {{count}} Zeichen ausgelassen … ',
        rowCut: ' … Rest der Zeile ({{count}} Zeichen) nicht angezeigt',
        previous: 'Vorherige Zeile mit Treffern',
        next: 'Nächste Zeile mit Treffern',
      },
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
        processing: 'Verarbeite...',
        ready: 'Bereit'
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
        },
        size: {
          tooltip: 'Eingabegröße / Ausgabegröße'
        }
      }
    }
  }
};