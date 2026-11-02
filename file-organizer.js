#!/usr/bin/env node
import path from 'path';
import { Scanner, formatSize, drawProgressBar } from './lib/scanner.js';
import { DuplicateFinder } from './lib/duplicates.js';
import { Organizer } from './lib/organizer.js';
import { Cleanup } from './lib/cleanup.js';

const SEPARATOR = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/**
 * Renders an inline progress line (handles both TTY and non-TTY streams cleanly).
 * @param {string} prefix
 * @param {number} current
 * @param {number} total
 * @param {string} suffix
 */
function updateProgressLine(prefix, current, total, suffix = '') {
  const bar = drawProgressBar(current, total, 20);
  const text = `${prefix} ${bar}${suffix ? ` ${suffix}` : ''}`;
  if (process.stdout.isTTY) {
    process.stdout.write(`\r${text}`);
    if (current === total) {
      process.stdout.write('\n');
    }
  } else if (current === total) {
    console.log(text);
  }
}

/**
 * Prints CLI usage instructions.
 */
function printHelp() {
  console.log(`
📦 File Organizer CLI (Node.js)
${SEPARATOR}
Usage:
  node file-organizer.js scan <directory>
  node file-organizer.js duplicates <directory>
  node file-organizer.js organize <source_directory> --output <target_directory>
  node file-organizer.js cleanup <directory> --older-than <days> [--confirm]

Examples:
  node file-organizer.js scan ~/Downloads
  node file-organizer.js duplicates ~/Downloads
  node file-organizer.js organize ~/Downloads --output ~/Organized
  node file-organizer.js cleanup ~/Downloads --older-than 90
  node file-organizer.js cleanup ~/Downloads --older-than 90 --confirm
`);
}

/**
 * Centralized error handler with POSIX error code inspection.
 * @param {Error & { code?: string, path?: string }} error
 * @param {string} target
 */
function handleFatalError(error, target = '') {
  const errTarget = error.path || target;
  if (error.code === 'ENOENT') {
    console.error(`❌ Error: Directory or file not found: ${errTarget}`);
  } else if (error.code === 'EACCES' || error.code === 'EPERM') {
    console.error(`❌ Error: Permission denied: ${errTarget}`);
  } else if (error.code === 'ENOTDIR') {
    console.error(`❌ Error: Path is not a directory: ${errTarget}`);
  } else if (error.code === 'EISDIR') {
    console.error(`❌ Error: Expected a file, but found a directory: ${errTarget}`);
  } else {
    console.error(`❌ Error: ${error.message}`);
  }
  process.exit(1);
}

/**
 * Executes the `scan` command.
 * @param {string[]} args
 */
async function runScanCommand(args) {
  const directory = args[0];
  if (!directory) {
    console.error('❌ Error: Missing target directory for "scan" command.');
    console.error('Usage: node file-organizer.js scan /path/to/directory');
    process.exit(1);
  }

  const scanner = new Scanner();

  scanner.on('scan-start', ({ directory: dir, totalDiscovered }) => {
    console.log(`📂 Scanning: ${dir}`);
    if (totalDiscovered === 0) {
      console.log(`Processing... ${drawProgressBar(0, 0)} files`);
    }
  });

  scanner.on('file-found', ({ current, total }) => {
    updateProgressLine('Processing...', current, total, 'files');
  });

  scanner.on('scan-complete', (stats) => {
    console.log('\n📊 Scan Results:');
    console.log(SEPARATOR);
    console.log(`Total files: ${stats.totalFiles}`);
    console.log(`Total size: ${formatSize(stats.totalSize)}`);

    console.log('\nBy File Type:');
    if (stats.byExtension.length === 0) {
      console.log('  (none)');
    } else {
      for (const item of stats.byExtension) {
        const extLabel = item.ext.padEnd(10, ' ');
        const countLabel = `${item.count} ${item.count === 1 ? 'file' : 'files'}`.padStart(9, ' ');
        const sizeLabel = formatSize(item.totalSize).padStart(10, ' ');
        console.log(`  ${extLabel} ${countLabel} ${sizeLabel}`);
      }
    }

    console.log('\nFile Age:');
    console.log(`  Last 7 days:    ${stats.ageStats.last7Days} files`);
    console.log(`  Last 30 days:   ${stats.ageStats.last30Days} files`);
    console.log(`  Older than 90:  ${stats.ageStats.olderThan90Days} files`);

    console.log('\nLargest files:');
    if (stats.largestFiles.length === 0) {
      console.log('  (none)');
    } else {
      stats.largestFiles.forEach((file, idx) => {
        const nameLabel = file.name.padEnd(24, ' ');
        console.log(`  ${idx + 1}. ${nameLabel} ${formatSize(file.size)}`);
      });
    }

    if (stats.oldestFile) {
      console.log(
        `\nOldest file: ${stats.oldestFile.name} (modified ${stats.oldestFile.daysOld} days ago)`
      );
    } else {
      console.log('\nOldest file: N/A');
    }
  });

  await scanner.scan(directory);
}

/**
 * Executes the `duplicates` command.
 * @param {string[]} args
 */
async function runDuplicatesCommand(args) {
  const directory = args[0];
  if (!directory) {
    console.error('❌ Error: Missing target directory for "duplicates" command.');
    console.error('Usage: node file-organizer.js duplicates /path/to/directory');
    process.exit(1);
  }

  const finder = new DuplicateFinder();

  finder.on('search-start', ({ directory: dir, totalFiles }) => {
    console.log(`🔍 Searching for duplicates in: ${dir}`);
    if (totalFiles === 0) {
      console.log(`Calculating hashes... ${drawProgressBar(0, 0)} files`);
    }
  });

  finder.on('file-processed', ({ current, total }) => {
    updateProgressLine('Calculating hashes...', current, total, 'files');
  });

  finder.on('duplicates-found', ({ groups, totalGroups, totalWastedSpace }) => {
    if (totalGroups === 0) {
      console.log('\n✅ No duplicate files found!');
      return;
    }

    console.log(
      `\nFound ${totalGroups} duplicate ${totalGroups === 1 ? 'group' : 'groups'} (${formatSize(totalWastedSpace)} wasted):\n`
    );

    groups.forEach((group, index) => {
      console.log(SEPARATOR);
      console.log(
        `Group ${index + 1} (${group.copies} copies, ${formatSize(group.size)} each):`
      );
      console.log(`  SHA-256: ${group.hash.slice(0, 12)}...\n`);
      for (const displayPath of group.displayFiles) {
        console.log(`  📄 ${displayPath}`);
      }
      console.log(`\n  Wasted space: ${formatSize(group.wastedSpace)}\n`);
    });

    console.log(SEPARATOR);
    console.log(`💾 Total wasted space: ${formatSize(totalWastedSpace)}`);
  });

  await finder.findDuplicates(directory);
}

/**
 * Executes the `organize` command.
 * @param {string[]} args
 */
async function runOrganizeCommand(args) {
  const sourceDir = args[0];
  const outputFlagIdx = args.indexOf('--output');
  const targetDir =
    outputFlagIdx !== -1 && args[outputFlagIdx + 1]
      ? args[outputFlagIdx + 1]
      : null;

  if (!sourceDir || !targetDir) {
    console.error(
      '❌ Error: Both source directory and --output <target_directory> are required for "organize".'
    );
    console.error(
      'Usage: node file-organizer.js organize /source/directory --output /target/directory'
    );
    process.exit(1);
  }

  const resolvedSource = path.resolve(sourceDir);
  const resolvedTarget = path.resolve(targetDir);

  console.log(`📦 Organizing: ${resolvedSource}`);
  console.log(`Target: ${resolvedTarget}\n`);
  console.log('Creating folders...');

  const organizer = new Organizer();

  organizer.on('folder-created', ({ category }) => {
    console.log(`  ✓ ${category}/`);
  });

  let startedCopying = false;
  organizer.on('copy-start', ({ current, total }) => {
    if (!startedCopying) {
      console.log('');
      startedCopying = true;
    }
    if (total === 0) {
      console.log(`Copying files... ${drawProgressBar(0, 0)}`);
    }
  });

  organizer.on('copy-complete', ({ current, total }) => {
    updateProgressLine('Copying files...', current, total);
  });

  organizer.on('copy-error', ({ sourcePath, error }) => {
    console.error(`\n❌ Failed to copy ${sourcePath}: ${error.message}`);
  });

  organizer.on(
    'organize-complete',
    ({ summary, totalCopied, totalSize, targetDir: finalTarget }) => {
      if (!startedCopying) {
        console.log(`\nCopying files... ${drawProgressBar(0, 0)}`);
      }
      console.log('\n✅ Organization complete!\n');
      console.log('Summary:');
      const targetBaseName = path.basename(finalTarget);
      for (const [category, info] of Object.entries(summary)) {
        const catLabel = `${category}:`.padEnd(11, ' ');
        const countStr = `${info.count} files`.padStart(9, ' ');
        console.log(
          `  ${catLabel} ${countStr} → ${targetBaseName}/${category}/`
        );
      }
      console.log(
        `\nTotal copied: ${totalCopied} files (${formatSize(totalSize)})`
      );
    }
  );

  await organizer.organize(sourceDir, targetDir);
}

/**
 * Executes the `cleanup` command.
 * @param {string[]} args
 */
async function runCleanupCommand(args) {
  const directory = args[0];
  const olderThanIdx = args.indexOf('--older-than');
  const olderThanRaw =
    olderThanIdx !== -1 && args[olderThanIdx + 1]
      ? args[olderThanIdx + 1]
      : null;
  const confirmed = args.includes('--confirm');

  if (!directory || olderThanRaw === null) {
    console.error(
      '❌ Error: Directory and --older-than <days> are required for "cleanup".'
    );
    console.error(
      'Usage: node file-organizer.js cleanup /path/to/directory --older-than 90 [--confirm]'
    );
    process.exit(1);
  }

  const thresholdDays = Number(olderThanRaw);
  if (Number.isNaN(thresholdDays) || thresholdDays < 0) {
    console.error(
      `❌ Error: Invalid value for --older-than: "${olderThanRaw}". Must be a non-negative number.`
    );
    process.exit(1);
  }

  const resolvedDir = path.resolve(directory);
  console.log(`🧹 Cleanup: ${resolvedDir}`);
  console.log(`Looking for files older than ${thresholdDays} days...\n`);

  const cleanup = new Cleanup();
  let printedHeader = false;
  let startedDeleting = false;

  cleanup.on('file-deleted', ({ current, total }) => {
    if (!startedDeleting) {
      startedDeleting = true;
    }
    updateProgressLine('Deleting...', current, total);
  });

  cleanup.on(
    'cleanup-complete',
    ({
      files,
      totalFiles,
      totalSize,
      deletedCount,
      freedSize,
      confirmed: isConfirmed
    }) => {
      if (totalFiles === 0) {
        console.log(`✅ No files found older than ${thresholdDays} days.`);
        return;
      }

      if (!printedHeader) {
        console.log(`Found ${totalFiles} files to delete:\n`);
        for (const file of files) {
          console.log(SEPARATOR);
          console.log(file.relativePath);
          console.log(`  Size: ${formatSize(file.size)}`);
          console.log(
            `  Modified: ${file.daysOld} days ago (${file.modifiedDate})`
          );
        }
        console.log(`${SEPARATOR}\n`);
        console.log(`Total: ${totalFiles} files (${formatSize(totalSize)})\n`);
        printedHeader = true;
      }

      if (!isConfirmed) {
        console.log('⚠️  DRY RUN MODE: No files were deleted.');
        console.log('To actually delete these files, run with --confirm flag.');
      } else {
        console.log('\n✅ Cleanup complete!');
        console.log(
          `Deleted: ${deletedCount} files (${formatSize(freedSize)} freed)`
        );
      }
    }
  );

  // Hook file-found to collect, and if confirmed, print warning before deletion starts
  const foundDuringScan = [];
  cleanup.on('file-found', (candidate) => {
    foundDuringScan.push(candidate);
  });

  // Override file-deleted first step so candidate summary prints before the deletion bar
  const originalListeners = cleanup.listeners('file-deleted');
  cleanup.removeAllListeners('file-deleted');
  cleanup.on('file-deleted', ({ current, total }) => {
    if (current === 1 && !printedHeader) {
      const sumSize = foundDuringScan.reduce((acc, f) => acc + f.size, 0);
      console.log(`Found ${foundDuringScan.length} files to delete:\n`);
      for (const file of foundDuringScan) {
        console.log(SEPARATOR);
        console.log(file.relativePath);
        console.log(`  Size: ${formatSize(file.size)}`);
        console.log(
          `  Modified: ${file.daysOld} days ago (${file.modifiedDate})`
        );
      }
      console.log(`${SEPARATOR}\n`);
      console.log(
        `⚠️  DELETING ${foundDuringScan.length} files (${formatSize(sumSize)}). This action cannot be undone!\n`
      );
      printedHeader = true;
    }
    for (const listener of originalListeners) {
      listener({ current, total });
    }
  });

  await cleanup.clean(directory, thresholdDays, confirmed);
}

/**
 * Main CLI entrypoint.
 */
async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || command === '--help' || command === '-h') {
    printHelp();
    process.exit(0);
  }

  try {
    switch (command) {
      case 'scan':
        await runScanCommand(args);
        break;
      case 'duplicates':
        await runDuplicatesCommand(args);
        break;
      case 'organize':
        await runOrganizeCommand(args);
        break;
      case 'cleanup':
        await runCleanupCommand(args);
        break;
      default:
        console.error(`❌ Unknown command: "${command}"`);
        printHelp();
        process.exit(1);
    }
  } catch (error) {
    handleFatalError(error, args[0]);
  }
}

main();
