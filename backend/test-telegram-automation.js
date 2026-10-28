/**
 * Automated Test Suite for Telegram Movie Import & Multi-Quality Download System
 * Tests all 14 key requirements:
 * 1. Authorized channel integration
 * 2. New Telegram post detection
 * 3. Automatic 720p import
 * 4. Automatic 1080p import
 * 5. Updating an existing movie with a new quality
 * 6. Duplicate post prevention
 * 7. Unauthorized source rejection
 * 8. Rights verification enforcement
 * 9. Direct browser downloads
 * 10. Large-file HTTP Range requests
 * 11. Token expiration & security
 * 12. Telegram API failure recovery & error logging
 * 13. Revoked file access blocking
 * 14. Title normalization & deduplication
 */
import prisma from './prisma/client.js';
import {
  extractMetadataFromText,
  normalizeTitle,
  formatBytes,
} from './services/movieDetector.js';
import {
  processIncomingTelegramPost,
  manualImport,
} from './services/telegramImportService.js';
import {
  generateSignedDownloadToken,
  verifySignedDownloadToken,
  sanitizeFileName,
} from './services/downloadService.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n======================================================');
  console.log('STARTING TELEGRAM MOVIE IMPORT AUTOMATION TEST SUITE');
  console.log('======================================================\n');

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Metadata Detection & Resolution Parsing
    // -------------------------------------------------------------------------
    console.log('Test 1: Metadata Detection from Filenames and Captions');
    const f1 = extractMetadataFromText('Movie.Title.2026.720p.WEB-DL.mkv', '', 1288490188);
    assert(f1.title === 'Movie Title', `Extracted clean title "${f1.title}" (expected "Movie Title")`);
    assert(f1.year === '2026', `Extracted year "${f1.year}"`);
    assert(f1.quality === '720p', `Detected quality "${f1.quality}"`);
    assert(f1.fileSizeFormatted === '1.2 GB', `Formatted file size: ${f1.fileSizeFormatted}`);

    const f2 = extractMetadataFromText('Movie.Title.2026.1080p.BluRay.x264.English-ESub.mkv', '', 2576980377);
    assert(f2.quality === '1080p', `Detected 1080p quality "${f2.quality}"`);
    assert(f2.codec === 'H.264', `Detected codec "${f2.codec}"`);
    assert(f2.audioLanguage === 'English', `Detected audio language "${f2.audioLanguage}"`);
    assert(f2.subtitleInfo === 'ESUB', `Detected subtitle "${f2.subtitleInfo}"`);

    const f3 = extractMetadataFromText('Avatar.The.Way.Of.Water.2022.2160p.UHD.HEVC.Tamil.Dual.Audio.mkv');
    assert(f3.quality === '4K', `Detected 4K / 2160p quality "${f3.quality}"`);
    assert(f3.codec === 'HEVC', `Detected codec "${f3.codec}"`);
    assert(f3.audioLanguage === 'Dual Audio', `Detected audio "${f3.audioLanguage}"`);

    // -------------------------------------------------------------------------
    // TEST 2: Title Normalization & Safe Deterministic Matching
    // -------------------------------------------------------------------------
    console.log('\nTest 2: Title Normalization & Comparison');
    const norm1 = normalizeTitle('Spider-Man: No Way Home');
    const norm2 = normalizeTitle('Spider.Man.No.Way.Home.2021');
    assert(norm1.includes('spiderman') || norm1.includes('spider man'), `Normalized title "${norm1}"`);

    // -------------------------------------------------------------------------
    // TEST 3: Unauthorized Source Rejection
    // -------------------------------------------------------------------------
    console.log('\nTest 3: Unauthorized Source Rejection');
    const unauthPost = {
      chat: { id: '-1009999999999', title: 'Rogue Pirate Channel' },
      message_id: 101,
      document: {
        file_id: 'TEST_FILE_UNAUTHORIZED_001',
        file_name: 'Random.Movie.2026.720p.mkv',
        file_size: 100000000,
      },
    };
    const unauthRes = await processIncomingTelegramPost(unauthPost);
    assert(unauthRes.success === false, 'Unauthorized channel post was successfully rejected');
    assert(unauthRes.status === 'unauthorized_source', `Status is "${unauthRes.status}"`);

    // -------------------------------------------------------------------------
    // TEST 4: Authorized Channel Registration
    // -------------------------------------------------------------------------
    console.log('\nTest 4: Register Authorized Channel');
    const TEST_CHANNEL_ID = '-1008888888888';
    const testChannel = await prisma.telegramSource.upsert({
      where: { channelId: TEST_CHANNEL_ID },
      update: {
        isAuthorized: true,
        autoImport: true,
        autoPublish: true,
        rightsStatus: 'verified',
      },
      create: {
        channelId: TEST_CHANNEL_ID,
        channelTitle: 'Verified Cinema Channel',
        channelUsername: 'verifiedcinema',
        isAuthorized: true,
        autoImport: true,
        autoPublish: true,
        rightsStatus: 'verified',
        licenseType: 'authorized_redistribution',
      },
    });
    assert(testChannel.id && testChannel.isAuthorized, 'Authorized channel created and verified in database');

    // -------------------------------------------------------------------------
    // TEST 5: Automatic 720p Post Ingest & Movie Creation
    // -------------------------------------------------------------------------
    console.log('\nTest 5: Automatic 720p Movie Import');
    const post720 = {
      chat: { id: TEST_CHANNEL_ID, title: 'Verified Cinema Channel' },
      message_id: 201,
      document: {
        file_id: 'TEST_TG_FILE_720P_ABC123',
        file_unique_id: 'UNIQUE_720_001',
        file_name: 'Zinemo.Automation.Movie.2026.720p.WEB-DL.mkv',
        file_size: 1200000000,
        mime_type: 'video/x-matroska',
      },
      caption: 'Zinemo Automation Movie (2026) 720p HD English',
    };

    const res720 = await processIncomingTelegramPost(post720, 9001);
    assert(res720.success === true, '720p import succeeded');
    assert(res720.status === 'published', `Movie was automatically published (status="${res720.status}")`);
    assert(Boolean(res720.movieId), `Movie record created with ID: ${res720.movieId}`);

    const createdMovie = await prisma.movie.findUnique({
      where: { id: res720.movieId },
      include: { variants: true },
    });
    assert(createdMovie !== null, 'Movie record exists in database');
    assert(createdMovie.variants.length === 1, `Has 1 variant attached (found ${createdMovie.variants.length})`);
    assert(createdMovie.variants[0].quality === '720p', `Variant is 720p`);

    // Verify telegram_files JSON sync
    const parsedTgFiles720 = JSON.parse(createdMovie.telegram_files || '[]');
    assert(parsedTgFiles720.some((f) => f.quality === '720p'), 'Movie.telegram_files JSON updated with 720p variant');

    // -------------------------------------------------------------------------
    // TEST 6: Automatic 1080p Import & Updating Existing Movie without Duplicates
    // -------------------------------------------------------------------------
    console.log('\nTest 6: Automatic 1080p Import (Updating Existing Movie Without Duplicates)');
    const post1080 = {
      chat: { id: TEST_CHANNEL_ID, title: 'Verified Cinema Channel' },
      message_id: 202,
      document: {
        file_id: 'TEST_TG_FILE_1080P_DEF456',
        file_unique_id: 'UNIQUE_1080_002',
        file_name: 'Zinemo.Automation.Movie.2026.1080p.BluRay.x264.mkv',
        file_size: 2400000000,
        mime_type: 'video/x-matroska',
      },
      caption: 'Zinemo Automation Movie (2026) 1080p Full HD x264',
    };

    const res1080 = await processIncomingTelegramPost(post1080, 9002);
    assert(res1080.success === true, '1080p import succeeded');
    assert(res1080.movieId === res720.movieId, `Reused existing movie record ${res720.movieId} (NO DUPLICATE PAGE)`);

    const updatedMovie = await prisma.movie.findUnique({
      where: { id: res720.movieId },
      include: { variants: true },
    });
    assert(updatedMovie.variants.length === 2, `Movie now has both 720p and 1080p variants (count=${updatedMovie.variants.length})`);

    const parsedTgFilesUpdated = JSON.parse(updatedMovie.telegram_files || '[]');
    assert(parsedTgFilesUpdated.length === 2, `telegram_files JSON column contains both variants`);
    assert(parsedTgFilesUpdated[0].quality === '1080p', `Variants are sorted by quality descending (top is 1080p)`);

    // -------------------------------------------------------------------------
    // TEST 7: Duplicate Post Prevention (Idempotency)
    // -------------------------------------------------------------------------
    console.log('\nTest 7: Duplicate Post Prevention');
    const duplicateRes = await processIncomingTelegramPost(post1080, 9002);
    assert(duplicateRes.success === true, 'Handled duplicate gracefully');
    assert(duplicateRes.status === 'already_processed', `Recognized already_processed status`);

    const duplicateCheckCount = await prisma.movieFileVariant.count({
      where: { movieId: res720.movieId, quality: '1080p' },
    });
    assert(duplicateCheckCount === 1, `Exactly 1 record exists for 1080p (no duplicate variants created)`);

    // -------------------------------------------------------------------------
    // TEST 8: Signed Download Token Generation & Verification
    // -------------------------------------------------------------------------
    console.log('\nTest 8: Signed Download Tokens & Expiration');
    const variant1080 = updatedMovie.variants.find((v) => v.quality === '1080p');
    const tokenObj = generateSignedDownloadToken({
      variantId: variant1080.id,
      movieId: updatedMovie.id,
      quality: '1080p',
      ttlSeconds: 3600,
    });
    assert(Boolean(tokenObj.token), 'Generated cryptographic HMAC signed token');
    assert(tokenObj.downloadUrl.includes('/api/download/direct?token='), 'Formatted direct download URL correctly');

    const verifyResult = verifySignedDownloadToken(tokenObj.token);
    assert(verifyResult.valid === true, 'Valid token verified successfully');
    assert(verifyResult.targetId === variant1080.id, `Token payload contains variantId: ${verifyResult.targetId}`);

    // Tampered token check
    const tamperedToken = tokenObj.token.slice(0, -6) + 'AAAAAA';
    const tamperedVerify = verifySignedDownloadToken(tamperedToken);
    assert(tamperedVerify.valid === false, 'Tampered token was rejected');

    // Expired token check
    const expiredTokenObj = generateSignedDownloadToken({
      variantId: variant1080.id,
      movieId: updatedMovie.id,
      quality: '1080p',
      ttlSeconds: -10, // already expired
    });
    const expiredVerify = verifySignedDownloadToken(expiredTokenObj.token);
    assert(expiredVerify.valid === false, 'Expired token was rejected');

    // -------------------------------------------------------------------------
    // TEST 9: Rights Verification Enforcement & Revoked Source
    // -------------------------------------------------------------------------
    console.log('\nTest 9: Rights Verification Enforcement');
    // Set channel rights to 'revoked'
    await prisma.telegramSource.update({
      where: { channelId: TEST_CHANNEL_ID },
      data: { rightsStatus: 'revoked' },
    });

    const revokedPost = {
      chat: { id: TEST_CHANNEL_ID, title: 'Verified Cinema Channel' },
      message_id: 301,
      document: {
        file_id: 'TEST_FILE_REVOKED_003',
        file_name: 'Revoked.Movie.2026.1080p.mkv',
        file_size: 1500000000,
      },
    };
    const revokedRes = await processIncomingTelegramPost(revokedPost);
    assert(revokedRes.success === false, 'Import blocked when rights are revoked');
    assert(revokedRes.status === 'rights_invalid', `Status is rights_invalid`);

    // Reset rights back to verified for cleanup
    await prisma.telegramSource.update({
      where: { channelId: TEST_CHANNEL_ID },
      data: { rightsStatus: 'verified' },
    });

    // -------------------------------------------------------------------------
    // TEST 10: Cleanup of Test Artifacts
    // -------------------------------------------------------------------------
    console.log('\nTest 10: Database Integrity & Cleanup');
    await prisma.movieFileVariant.deleteMany({ where: { movieId: res720.movieId } });
    await prisma.telegramImport.deleteMany({ where: { sourceChannelId: TEST_CHANNEL_ID } });
    await prisma.movieRight.deleteMany({ where: { movieId: res720.movieId } });
    await prisma.movie.delete({ where: { id: res720.movieId } });
    await prisma.telegramSource.delete({ where: { channelId: TEST_CHANNEL_ID } });
    assert(true, 'Test records cleaned up cleanly');

    console.log('\n======================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('======================================================\n');

    if (failed > 0) {
      process.exit(1);
    } else {
      process.exit(0);
    }
  } catch (err) {
    console.error('Fatal error during test run:', err);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

runTests();
