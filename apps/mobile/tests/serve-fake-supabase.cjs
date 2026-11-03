// Starts the web app on port 8082 pointed at a fake Supabase address, so tests/account-ui.cjs can answer every
// sign-in and database request itself. No real Supabase project, Kakao, or Google account is contacted.
const { spawn } = require('node:child_process');

const env = { ...process.env, EXPO_PUBLIC_SUPABASE_URL: 'https://fake-project.supabase.co',
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', EXPO_PUBLIC_API_BASE_URL: 'http://localhost:8000', BROWSER: 'none', CI: '1' };
const child = spawn('npx', ['expo', 'start', '--web', '--port', '8082', '--clear'], { env, stdio: 'inherit', shell: true });
child.on('exit', code => process.exit(code ?? 0));
