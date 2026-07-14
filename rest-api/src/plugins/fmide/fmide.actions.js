const service = require('./fmide.service');
const solutions = require('../../config/solutions');

/**
 * fmIDE plugin actions, invoked via the generic plugin-action endpoint
 * `POST /api/plugins/fmide/actions/:action`.
 *
 * `onEnable` is a lifecycle hook the plugins controller calls when the plugin
 * is switched on (the "first scan on activation"). `rescan` re-runs the catalog
 * scan on demand (the settings panel's Rescan button). Both run the DuckDB scan
 * and persist the per-file result. The generic action dispatcher does not pass
 * the request through, so both scans run in the server-default context.
 */
module.exports = {
  rescan: () => service.refreshFileStatuses(solutions.serverDefaultContext()),
  onEnable: () => service.refreshFileStatuses(solutions.serverDefaultContext()),
};
