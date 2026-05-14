// Hook PreToolUse (Edit|Write): bloquea la edición de archivos .env*
// para prevenir que un secret termine en un commit. Los .env se editan
// a mano fuera de Claude.
//
// Lee el JSON del tool en stdin, devuelve un permissionDecision por stdout.
let raw = '';
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    const input = JSON.parse(raw);
    const file = (input.tool_input || {}).file_path || '';
    // matchea .env, .env.local, .env.production, foo/.env, etc.
    const isEnv = /(^|[\\/.])\.env(\.|$)/.test(file);
    if (isEnv) {
      console.log(
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason:
              'Edición de archivos .env bloqueada para prevenir fuga de secrets. Editalos a mano fuera de Claude.',
          },
        }),
      );
    } else {
      console.log('{}');
    }
  } catch {
    // Si el JSON no parsea, no bloqueamos (fail-open: no romper el flujo normal).
    console.log('{}');
  }
});
