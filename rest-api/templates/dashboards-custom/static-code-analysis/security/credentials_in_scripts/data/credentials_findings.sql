-- @template_type: report
-- @description: Lists every script step that contains a credential-related keyword
--               (password, secret, apikey, token, …). Surgical masking: only string
--               literals in structural "value position" (Set Variable Value, JSON
--               setter value, send-mail parameter value, HTTP-header value inside
--               a string literal) are replaced with "*****". Dialog labels and
--               unrelated strings stay readable. The matched keyword is returned
--               separately so the frontend can highlight it on click via ?sq=<keyword>.
-- @params: file (optional), limit (optional, default 500)
--
-- Click navigation: uuid is the Script_UUID, type=Script, and params.sq carries the
-- keyword so the script detail view can scroll/highlight to the relevant lines.
--
-- NOTE: The keyword pattern MUST be inlined (not stored in a CTE) — referencing it
-- via `(SELECT p FROM pat)` triggers a BLOCKWISE_NL_JOIN that scales catastrophically
-- (~4s on 200k rows). Keeping the pattern as a string literal lets DuckDB push the
-- regex filter into the table scan (~60ms).

WITH hits AS (
    SELECT
        s.Script_UUID,
        s.Script_Name,
        s.Step_UUID,
        s.Step_Index,
        s.Step_Name,
        s.File_Name,
        d.Step_Text                                            AS txt_orig,
        -- Surgical masking — four targeted patterns chained:
        --   A) Set Variable [$<credentialVar>; Value:"X"]     → mask "X"
        --   B) JSON setter ["<credentialKey>"; "X"; …]        → mask "X"
        --   C) Send-Mail / parameter "<Keyword>: "X""         → mask "X" (word-boundary required)
        --   D) HTTP-header inside one string: "Authorization: Bearer X" → mask after the header marker
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(d.Step_Text,
                '(?i)(\$\$?[A-Za-z_0-9]*(password|passwort|pswd|kennwort|secret|apikey|api_key|credential|passphrase|token|bearer|client_secret|clientsecret|access_token|accesstoken|refresh_token|refreshtoken|private_key|privatekey|basic_auth|hmac|signingkey|userpass|login_password)[A-Za-z_0-9]*\s*;\s*Value:\s*)"[^"]*"',
                '\1"*****"', 'g'),
              '(?i)("[A-Za-z_]*(password|passwort|secret|apikey|api_key|credential|passphrase|token|client_secret|access_token|refresh_token|private_key|signingkey)[A-Za-z_]*"\s*[;,]\s*)"[^"]*"',
              '\1"*****"', 'g'),
            '(?i)((^|[\s;,\[])(Password|Passwort|Token|API[_\- ]?Key|Secret|Authorization)\s*:\s*)"[^"]+"',
            '\1"*****"', 'g'),
          '(?i)"((Authorization|X[-_]API[-_]Key|Cookie|Bearer)\s*:?\s*)([^"]+)"',
          '"\1*****"', 'g')                                    AS txt_masked,
        regexp_extract(LOWER(d.Step_Text), '(password|passwort|pswd|kennwort|pwd|secret|apikey|api_key|api-key|credential|passphrase|token|bearer|mdp|senha|contrase|authorization|client_secret|clientsecret|access_token|accesstoken|refresh_token|refreshtoken|private_key|privatekey|basic_auth|hmac|signingkey|userpass|login_password|signature)') AS matched_keyword
    FROM StepsForScripts s
    JOIN DDR_ScriptSteps d ON s.Step_UUID = d.Step_UUID
    WHERE d.Step_Text IS NOT NULL
      AND regexp_matches(LOWER(d.Step_Text), '(password|passwort|pswd|kennwort|pwd|secret|apikey|api_key|api-key|credential|passphrase|token|bearer|mdp|senha|contrase|authorization|client_secret|clientsecret|access_token|accesstoken|refresh_token|refreshtoken|private_key|privatekey|basic_auth|hmac|signingkey|userpass|login_password|signature)')
      AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
),
located AS (
    SELECT
        *,
        POSITION(matched_keyword IN LOWER(txt_masked)) AS pos_m
    FROM hits
)
SELECT
    Script_UUID                                        AS uuid,
    File_Name                                          AS file,
    Script_Name                                        AS script,
    Step_Index                                         AS step_index,
    Step_Name                                          AS step_name,
    matched_keyword                                    AS keyword,
    CASE
        WHEN pos_m > 0
            THEN SUBSTRING(txt_masked, GREATEST(1, pos_m - 60), 200)
        ELSE SUBSTRING(txt_masked, 1, 200)
    END                                                AS snippet
FROM located
ORDER BY file, script, step_index
LIMIT CAST(COALESCE(getvariable('limit'), '500') AS INTEGER);
