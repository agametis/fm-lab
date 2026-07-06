-- @template_type: report
-- @description: Healthcheck counts — Security group. Detection logic is DUPLICATED
--   (v1.0 light, "Option A") from the static-code-analysis rule bundles so the tile
--   count equals the drill-down hit count. Each row deep-links to its rule dashboard.

SELECT key, label, value, severity, action, action_args FROM (
  SELECT 1 AS ord, 'account_with_full_access' AS key, 'Account with [Full Access]' AS label,
         (SELECT COUNT(*) FROM (
            SELECT 1
            FROM ObjectLinks ol
            JOIN ObjectCatalog p ON p.Object_UUID = ol.Target_UUID AND p.Object_Name = '[Full Access]'
            JOIN ObjectCatalog acc ON acc.Object_UUID = ol.Source_UUID AND acc.Object_Type = 'Account'
            WHERE ol.Link_Role = 'privilege_set'
              AND (getvariable('file') IS NULL OR acc.File_Name = getvariable('file'))
         ) t) AS value,
         'warn' AS severity, 'openDashboard' AS action, 'id=account_with_full_access' AS action_args
  UNION ALL
  SELECT 2, 'password_field_plaintext', 'Password field stored as plain text',
         (SELECT COUNT(*) FROM (
            SELECT 1
            FROM FieldsForTables f
            WHERE regexp_matches(LOWER(f.Field_Name), '(password|passwort|kennwort|\bpin\b)')
              AND f.Field_Type = 'Normal' AND COALESCE(f.Is_Global, '') <> 'True'
              AND (getvariable('file') IS NULL OR f.File_Name = getvariable('file'))
         ) t),
         'warn', 'openDashboard', 'id=password_field_plaintext'
  UNION ALL
  SELECT 3, 'password_field_plaintext_display', 'Password shown as plain text',
         (SELECT COUNT(*) FROM (
            WITH pw AS (
                SELECT f.Field_UUID, f.File_Name, f.Table_Name, f.Field_Name
                FROM FieldsForTables f
                WHERE regexp_matches(LOWER(f.Field_Name), '(password|passwort|kennwort|\bpin\b)')
                  AND f.Field_Type = 'Normal' AND COALESCE(f.Is_Global, '') <> 'True'
            )
            SELECT 1
            FROM ObjectLinks ol
            JOIN pw ON pw.Field_UUID = ol.Target_UUID
            JOIN LayoutObjects lo ON lo.Object_UUID = ol.Source_UUID
            JOIN Layouts l ON l.L_ID = lo.Layout_ID AND l.File_Name = lo.File_Name
            WHERE ol.Link_Role = 'displays_field' AND ol.Source_Type = 'LayoutObject'
              AND lo.Object_XML NOT LIKE '%<Display Style="7"%'
              AND (getvariable('file') IS NULL OR lo.File_Name = getvariable('file'))
         ) t),
         'warn', 'openDashboard', 'id=password_field_plaintext_display'
  UNION ALL
  SELECT 4, 'secret_in_global_variable', 'Secret in global variable',
         (SELECT COUNT(*) FROM (
            SELECT 1
            FROM VariablesCatalog v
            WHERE v.Variable_Scope IN ('global', 'superglobal')
              AND regexp_matches(LOWER(v.Display_Name), '(password|passwort|secret|token|apikey|api_key)')
              AND (getvariable('file') IS NULL OR list_contains(v.Files, getvariable('file')))
         ) t),
         'warn', 'openDashboard', 'id=secret_in_global_variable'
  UNION ALL
  SELECT 5, 'credentials_in_scripts', 'Credentials in scripts',
         (SELECT COUNT(*) FROM (
            SELECT 1
            FROM StepsForScripts s
            JOIN DDR_ScriptSteps d ON s.Step_UUID = d.Step_UUID
            WHERE d.Step_Text IS NOT NULL
              AND regexp_matches(LOWER(d.Step_Text), '(password|passwort|pswd|kennwort|pwd|secret|apikey|api_key|api-key|credential|passphrase|token|bearer|mdp|senha|contrase|authorization|client_secret|clientsecret|access_token|accesstoken|refresh_token|refreshtoken|private_key|privatekey|basic_auth|hmac|signingkey|userpass|login_password|signature)')
              AND (getvariable('file') IS NULL OR s.File_Name = getvariable('file'))
         ) t),
         'warn', 'openDashboard', 'id=credentials_in_scripts'
) WHERE (getvariable('severity') IS NULL OR getvariable('severity') = '' OR severity = getvariable('severity'))
  ORDER BY ord;
