# MBS Function Reference Skill

This skill enables Claude to access the official documentation of the MonkeyBread Software (MBS) FileMaker Plugin through locally stored HTML files.

## Purpose

The MBS Plugin for FileMaker provides thousands of additional functions for FileMaker developers. This skill assists with the analysis of FileMaker scripts that use MBS functions by automatically retrieving the official documentation and providing context-aware explanations.

## Usage

### Automatic activation

The skill is activated automatically when:
- You ask about an MBS function
- Script analyses include MBS functions
- You explicitly ask: "Explain the MBS function X"

### Manual activation

```bash
# In the Claude Code CLI
/skill mbs-function-reference MBS.SQL.Execute
```

### Example requests

1. **Look up a single function**:
   ```
   What does the function MBS.SQL.Execute do?
   ```

2. **In a script context**:
   ```
   Analyse the script "Data Import" and explain the MBS functions used
   ```

3. **Best practices**:
   ```
   How do I use MBS.Dialog.Alert correctly?
   ```

## How it works

1. The skill identifies MBS function names in the text or in script analyses
2. It retrieves the documentation from `https://www.mbsplugins.eu/`
3. The documentation is parsed and structured
4. A context-aware explanation is generated

## URL pattern

The MBS documentation follows this pattern:
```
https://www.mbsplugins.eu/component_<FunctionName>.shtml
```

Examples:
- `MBS.SQL.Execute` → `https://www.mbsplugins.eu/component_MBS-SQL-Execute.shtml`
- `FM.Dialog.Alert` → `https://www.mbsplugins.eu/component_FM-Dialog-Alert.shtml`

## Output

The skill provides structured information:
- Function purpose and description
- Syntax with parameters
- Return values
- Availability (MBS version, platforms)
- Example code
- Best practices and common pitfalls

## Troubleshooting

### Documentation not found
- The skill should automatically find the correct documentation in the project directory under `/docs/mbs`
- If not, check the spelling of the function name

### Claude does not invoke the skill
- Explicitly use "MBS" in the function name
- Manually invoke the skill: `/skill mbs-function-reference`

## Extensions

You can extend the skill with:
- Local copies of the MBS documentation
- Cached documentation lookups
- Integration with the FileMaker DDR (Database Design Report)
- Automatic code examples in FileMaker syntax

## Resources

- [MBS Plugin documentation](https://www.mbsplugins.eu/)
- [MBS Plugin homepage](https://www.mbsplugins.com/)
- [Model Context Protocol](https://modelcontextprotocol.io/)

## License

This skill is part of the fm-lab project.
