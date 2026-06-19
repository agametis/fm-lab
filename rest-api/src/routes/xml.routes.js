const express = require('express');
const router = express.Router({ caseSensitive: false });
const xmlController = require('../controllers/xml.controller');

/**
 * XML-Convert Routes — siehe project/prd_frontend_xml_convert.md §5.
 *
 * Diese Routen steuern den XML→DuckDB-Konvertierungs-Prozess aus dem Web-
 * Frontend heraus (Sub-Dashboard "xml_convert"). Die eigentliche Logik bleibt
 * im Bash-Skript tools/convert_fm_xml.sh; der Service spawnt es im
 * `--quiet`-Modus und streamt dessen NDJSON-Events als SSE durch.
 */

router.get('/xml/status',         xmlController.getStatus);
router.get('/xml/last-run/log',   xmlController.getLastRunLog);
router.post('/xml/convert',       xmlController.convert);

module.exports = router;
