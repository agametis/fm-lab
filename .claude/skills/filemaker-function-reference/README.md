# FileMaker Function Reference Skill

This skill provides Claude with access to the official documentation of the currently released version of FileMaker Pro (Claris online help). The documentation is preferably loaded from a local cache and is only retrieved online when no matching cache is available.

## Purpose

FileMaker Pro is a development environment for custom applications. This skill assists with the analysis of FileMaker scripts by automatically retrieving the official documentation and providing context-aware explanations for FileMaker developers.

## Usage

### Automatic activation

The skill is activated automatically when:
- The user asks about a FileMaker function
- Script analyses contain commands (script steps) that need to be explained
- Calculation field analyses or CustomFunction analyses contain functions that need to be explained
- The user explicitly asks: "Explain the FileMaker function X"

### Manual activation

```bash
# In Claude Code CLI
/skill filemaker-function-reference floor
```

### Example requests

1. **Look up a single function**:
   ```
   What does the function floor do?
   ```

2. **In a calculation context**:
   ```
   Analyse the calculation in the field "Individual price" and explain the functions used
   ```

3. **In a script context**:
   ```
   Analyse the script "Data import" and explain the script steps used
   ```

4. **Best practices**:
   ```
   How do I use the Favorites window in FileMaker correctly?
   ```

## How it works

1. The skill identifies FileMaker function names and script step names in the text or in script analyses
2. It first tries to load the documentation from the local cache under [docs/claris-help/](../../../docs/claris-help/) — in the user's preferred language, with fallback to English
3. If no local cache is available (or the desired language is not installed), the online help is retrieved from `help.claris.com`
4. The documentation is analysed and presented in a structured form
5. A context-aware explanation in the user's language is generated

## Documentation sources — order

### 1. Local cache (preferred)

The skill first checks whether the Claris online help has been mirrored locally:

```
docs/claris-help/<lang>/content/<FunctionName>.html
```

Examples:
- `docs/claris-help/de/content/patterncount.html`
- `docs/claris-help/en/content/patterncount.html`

**Language fallback:** If the file is not available in the preferred language, the skill automatically falls back to English (`en`) — English is always part of the installation (see the skill `install-claris-docs`).

**Check:** Before the online retrieval, the skill verifies with `ls docs/claris-help/<lang>/content/<slug>.html` whether the file is available locally.

### 2. Online help (fallback)

If no local cache is available or the desired function has not been mirrored, the skill falls back to the online source:

```
https://help.claris.com/<lang>/pro-help/content/<FunctionName>.html
```

Examples in English:
- `Code` → `https://help.claris.com/en/pro-help/content/code.html`
- `PatternCount` → `https://help.claris.com/en/pro-help/content/patterncount.html`
- `GetAsDate` → `https://help.claris.com/en/pro-help/content/getasdate.html`

Examples in German:
- `Code` → `https://help.claris.com/de/pro-help/content/code.html`
- `MusterAnzahl` → `https://help.claris.com/de/pro-help/content/patterncount.html`
- `LiesAlsDatum` → `https://help.claris.com/de/pro-help/content/getasdate.html`

**Note:** The slugs in the path are always English, regardless of language (e.g. `patterncount.html`, not `musteranzahl.html`).

## Available language versions

The Claris online help is offered in 11 languages. English is the reference language and always available; further languages can be installed locally on demand.

| Code | Language              | Locally by default  | Note                                  |
|------|-----------------------|---------------------|---------------------------------------|
| `en` | English               | always              | Reference, fallback for missing slug  |
| `de` | German                | optional            | Recommended for German-speaking devs  |
| `es` | Spanish               | optional            |                                       |
| `fr` | French                | optional            |                                       |
| `it` | Italian               | optional            |                                       |
| `nl` | Dutch                 | optional            |                                       |
| `pt` | Portuguese            | optional            |                                       |
| `sv` | Swedish               | optional            |                                       |
| `ja` | Japanese              | optional            |                                       |
| `ko` | Korean                | optional            |                                       |
| `zh` | Chinese (simplified)  | optional            | URL segment `zh` (not `zh-Hans`)      |

**Local installation of language sets:** Use the separate skill [`install-claris-docs`](../install-claris-docs/SKILL.md) to download additional languages into `docs/claris-help/`. English is always installed alongside them.

## Output

The skill returns structured information:
- Function purpose and description
- Syntax with parameters
- Return values
- Availability (FileMaker version, platforms)
- Description
- Example code


## Resources

- Local cache: [docs/claris-help/](../../../docs/claris-help/)
- Installation skill: [install-claris-docs](../install-claris-docs/SKILL.md)
- FileMaker help German (online): [help.claris.com/de/pro-help/content/index.html](https://help.claris.com/de/pro-help/content/index.html)
- FileMaker help English (online): [help.claris.com/en/pro-help/content/index.html](https://help.claris.com/en/pro-help/content/index.html)

## License

This skill is part of the fm-lab project.
