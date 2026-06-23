// cytoscape-fcose ships no type declarations. It is a Cytoscape layout
// extension registered via `cytoscape.use(...)`; we only need the module to be
// importable (statically and dynamically) without TS7016.
declare module 'cytoscape-fcose';
