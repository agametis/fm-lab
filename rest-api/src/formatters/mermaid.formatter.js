/**
 * Mermaid Diagram Formatter (Hybrid)
 *
 * Zwei Modi:
 * 1. Auto-Generate: Baut Mermaid-Code aus strukturierten Graph-Daten
 * 2. Content-Fallback: Nutzt vorgefertigten Mermaid-Code aus 'content' Spalte
 *
 * Formate:
 * - format=mermaid     → HTML-Wrapper mit Mermaid.js (interaktiv)
 * - format=mermaid-raw → Nur Mermaid-Code (für Obsidian/VS Code)
 */

const MERMAID_CDN_VERSION = '10.6.1';
const MERMAID_CDN_URL = `https://cdn.jsdelivr.net/npm/mermaid@${MERMAID_CDN_VERSION}/dist/mermaid.min.js`;

/**
 * Main format function
 * @param {Array|Object} data - Query results
 * @param {Object} options - Formatting options
 * @param {boolean} options.raw - Return raw Mermaid code (format=mermaid-raw)
 * @param {string} options.theme - Mermaid theme (default, dark, forest, neutral)
 * @param {string} options.direction - Graph direction (TD, LR, BT, RL)
 * @param {string} options.title - Diagram title
 * @param {Object} options.meta - Template metadata
 * @returns {string} - Mermaid code or HTML
 */
function format(data, options = {}) {
  if (!Array.isArray(data)) {
    data = [data];
  }

  if (data.length === 0) {
    throw new Error('Mermaid formatter: No data to format');
  }

  // Schritt 1: Erkenne Daten-Modus
  const mode = detectDataMode(data);

  // Schritt 2: Generiere Mermaid-Code
  let mermaidCode;
  if (mode === 'graph') {
    mermaidCode = buildGraphFromData(data, options);
  } else if (mode === 'content') {
    mermaidCode = extractContentColumn(data);
  } else {
    throw new Error('Mermaid formatter: Unable to detect graph structure or content column');
  }

  // Schritt 3: Return raw oder HTML
  if (options.raw) {
    return mermaidCode;
  } else {
    return buildHtmlWrapper(mermaidCode, options);
  }
}

/**
 * Erkenne Daten-Modus
 * @param {Array} data - Query results
 * @returns {string|null} - 'graph', 'content', or null
 */
function detectDataMode(data) {
  const firstRow = data[0];
  const keys = Object.keys(firstRow).map(k => k.toLowerCase());

  // Modus 1: Graph-Daten (source/target Spalten)
  if (keys.includes('source_uuid') && keys.includes('target_uuid')) {
    return 'graph';
  }

  // Modus 2: Content-Spalte (fertiger Mermaid-Code)
  if (keys.includes('content')) {
    return 'content';
  }

  return null;
}

/**
 * Baue Mermaid-Graph aus strukturierten Daten
 * @param {Array} data - Query results with source/target columns
 * @param {Object} options - Formatting options
 * @returns {string} - Mermaid graph code
 */
function buildGraphFromData(data, options = {}) {
  const direction = options.direction || options.meta?.mermaid_direction || 'TD';
  const lines = [`graph ${direction}`];

  // Sammle unique Nodes (using Map to preserve label)
  const nodes = new Map();
  const edges = [];

  data.forEach(row => {
    // Case-insensitive column access
    const sourceId = row.source_uuid || row.Source_UUID || row.SOURCE_UUID;
    const targetId = row.target_uuid || row.Target_UUID || row.TARGET_UUID;
    const sourceName = row.source_name || row.Source_Name || row.SOURCE_NAME || sourceId;
    const targetName = row.target_name || row.Target_Name || row.TARGET_NAME || targetId;
    const edgeLabel = row.edge_label || row.Edge_Label || row.EDGE_LABEL || '';

    if (!sourceId || !targetId) {
      // Skip rows without valid source/target
      return;
    }

    const sanitizedSourceId = sanitizeId(sourceId);
    const sanitizedTargetId = sanitizeId(targetId);

    // Store nodes with their labels
    if (!nodes.has(sanitizedSourceId)) {
      nodes.set(sanitizedSourceId, sourceName);
    }
    if (!nodes.has(sanitizedTargetId)) {
      nodes.set(sanitizedTargetId, targetName);
    }

    // Store edge
    edges.push({
      from: sanitizedSourceId,
      to: sanitizedTargetId,
      label: edgeLabel
    });
  });

  // Generate node definitions
  nodes.forEach((label, id) => {
    lines.push(`  ${id}["${escapeLabel(label)}"]`);
  });

  // Generate edge definitions
  edges.forEach(edge => {
    if (edge.label) {
      lines.push(`  ${edge.from} -->|${escapeLabel(edge.label)}| ${edge.to}`);
    } else {
      lines.push(`  ${edge.from} --> ${edge.to}`);
    }
  });

  return lines.join('\n');
}

/**
 * Extrahiere Content-Spalte (Fallback-Modus)
 * @param {Array} data - Query results with content column
 * @returns {string} - Mermaid code from content column
 */
function extractContentColumn(data) {
  const lines = data.map(row => {
    return row.content || row.Content || '';
  });

  return lines.join('\n').trim();
}

/**
 * Sanitize Node-IDs für Mermaid
 * @param {string} id - Original node ID
 * @returns {string} - Sanitized ID
 */
function sanitizeId(id) {
  if (!id) return 'unknown';

  // Convert to string and replace special characters
  let sanitized = String(id)
    .replace(/[^a-zA-Z0-9_]/g, '_');

  // Ensure ID doesn't start with a number
  if (/^\d/.test(sanitized)) {
    sanitized = 'N' + sanitized;
  }

  return sanitized;
}

/**
 * Escape Labels für Mermaid
 * @param {string} text - Label text
 * @returns {string} - Escaped text
 */
function escapeLabel(text) {
  if (!text) return '';

  return String(text)
    .replace(/"/g, '\\"')      // Escape double quotes
    .replace(/\n/g, ' ')        // Replace newlines with spaces
    .replace(/\r/g, '');        // Remove carriage returns
}

/**
 * Baue HTML-Wrapper mit Mermaid.js
 * @param {string} mermaidCode - Mermaid diagram code
 * @param {Object} options - Formatting options
 * @returns {string} - Complete HTML document
 */
function buildHtmlWrapper(mermaidCode, options = {}) {
  const theme = options.theme || 'default';
  const title = options.title || 'FileMaker Diagram';
  const description = options.meta?.template_description || '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>

  <!-- Mermaid.js from CDN -->
  <script src="${MERMAID_CDN_URL}"></script>
  <script>
    mermaid.initialize({
      startOnLoad: true,
      theme: '${theme}',
      securityLevel: 'loose',
      flowchart: {
        useMaxWidth: true,
        htmlLabels: true,
        curve: 'basis'
      }
    });
  </script>

  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      background: ${theme === 'dark' ? '#1e1e1e' : '#f5f5f5'};
      padding: 20px;
    }

    .container {
      max-width: 1600px;
      margin: 0 auto;
      background: ${theme === 'dark' ? '#2d2d2d' : 'white'};
      border-radius: 8px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      padding: 30px;
    }

    h1 {
      color: ${theme === 'dark' ? '#e0e0e0' : '#333'};
      margin-bottom: 10px;
      font-size: 28px;
    }

    .description {
      color: ${theme === 'dark' ? '#b0b0b0' : '#666'};
      margin-bottom: 30px;
      font-size: 14px;
      line-height: 1.6;
    }

    .mermaid-container {
      background: ${theme === 'dark' ? '#2d2d2d' : 'white'};
      border: 1px solid ${theme === 'dark' ? '#444' : '#e0e0e0'};
      border-radius: 4px;
      padding: 20px;
      overflow-x: auto;
      min-height: 300px;
    }

    .mermaid {
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 250px;
    }

    .footer {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid ${theme === 'dark' ? '#444' : '#e0e0e0'};
      color: #999;
      font-size: 12px;
      text-align: center;
    }

    .footer a {
      color: #4CAF50;
      text-decoration: none;
    }

    .footer a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${escapeHtml(title)}</h1>
    ${description ? `<p class="description">${escapeHtml(description)}</p>` : ''}

    <div class="mermaid-container">
      <div class="mermaid">
${mermaidCode}
      </div>
    </div>

    <div class="footer">
      Generated by FM-Lab REST API &middot;
      Powered by <a href="https://mermaid.js.org" target="_blank">Mermaid.js</a>
    </div>
  </div>
</body>
</html>`;
}

/**
 * HTML escape utility
 * @param {string} text - Text to escape
 * @returns {string} - Escaped HTML
 */
function escapeHtml(text) {
  if (!text) return '';

  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };

  return String(text).replace(/[&<>"']/g, m => map[m]);
}

module.exports = { format };
