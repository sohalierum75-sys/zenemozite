/**
 * Verification test: Validates that all local modules and routes in the backend
 * can be resolved and imported by Node.js without ERR_MODULE_NOT_FOUND.
 */
async function testAllImports() {
  console.log('[TEST] Checking backend module imports resolution...');
  const modules = [
    './routes/telegramWebhookRoutes.js',
    './services/telegramImportService.js',
    './services/downloadService.js',
    './services/movieDetector.js',
    './adminRoutes.js',
    './storage/routes.js',
    './storage/telegramStore.js',
    './storage/telegramParser.js',
    './storage/config.js',
    './storage/hybridCache.js',
    './storage/worker.js',
    './listCache.js',
    './prisma/client.js'
  ];

  let passed = 0;
  let failed = 0;

  for (const modPath of modules) {
    try {
      await import(modPath);
      console.log(`  ✓ ${modPath} resolved and loaded successfully`);
      passed++;
    } catch (err) {
      console.error(`  ✗ FAIL: ${modPath} failed to load:`, err.message);
      failed++;
    }
  }

  console.log(`\n[TEST SUMMARY] ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('✅ ALL BACKEND MODULES RESOLVE 100% SUCCESSFULLY!\n');
    process.exit(0);
  }
}

testAllImports();
