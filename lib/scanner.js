import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Formats byte size into human-readable units (B, KB, MB, GB).
 * @param {number} bytes
 * @returns {string}
 */
export function formatSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Renders an ASCII progress bar string.
 * @param {number} current
 * @param {number} total
 * @param {number} width
 * @returns {string}
 */
export function drawProgressBar(current, total, width = 20) {
  if (total === 0) {
    return `${'█'.repeat(width)} 0/0`;
  }
  const percentage = Math.min(1, Math.max(0, current / total));
  const filled = Math.round(percentage * width);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  return `${bar} ${current}/${total}`;
}

/**
 * Recursively collects all regular file paths inside a directory.
 * @param {string} directory
 * @param {string|null} excludeDir
 * @returns {Promise<string[]>}
 */
export async function collectFilesRecursively(directory, excludeDir = null) {
  const resolvedRoot = path.resolve(directory);
  const resolvedExclude = excludeDir ? path.resolve(excludeDir) : null;

  const rootStat = await fs.stat(resolvedRoot);
  if (!rootStat.isDirectory()) {
    const err = new Error(`Path is not a directory: ${directory}`);
    err.code = 'ENOTDIR';
    err.path = directory;
    throw err;
  }

  const entries = await fs.readdir(resolvedRoot, {
    recursive: true,
    withFileTypes: true
  });

  const files = [];
  for (const entry of entries) {
    const parentPath = entry.parentPath || entry.path || resolvedRoot;
    const fullPath = path.join(parentPath, entry.name);

    if (
      resolvedExclude &&
      (fullPath === resolvedExclude ||
        fullPath.startsWith(resolvedExclude + path.sep))
    ) {
      continue;
    }

    if (entry.isFile()) {
      files.push(fullPath);
    } else if (entry.isSymbolicLink()) {
      try {
        const stat = await fs.stat(fullPath);
        if (stat.isFile()) {
          files.push(fullPath);
        }
      } catch {
        // Ignore broken symlinks
      }
    }
  }

  files.sort((a, b) => a.localeCompare(b));
  return files;
}

/**
 * Scanner class extending EventEmitter for recursive directory analysis.
 */
export class Scanner extends EventEmitter {
  /**
   * Scans the target directory and emits progress and final statistics.
   * @param {string} directory
   * @returns {Promise<object>}
   */
  async scan(directory) {
    const resolvedDir = path.resolve(directory);
    const filePaths = await collectFilesRecursively(resolvedDir);
    const total = filePaths.length;

    this.emit('scan-start', {
      directory: resolvedDir,
      totalDiscovered: total
    });

    let totalSize = 0;
    const extensionMap = new Map();
    const ageStats = {
      last7Days: 0,
      last30Days: 0,
      olderThan90Days: 0
    };
    const allFilesMeta = [];
    let oldestFile = null;
    const now = Date.now();

    for (let i = 0; i < total; i++) {
      const filePath = filePaths[i];
      const stats = await fs.stat(filePath);
      const size = stats.size;
      const mtime = stats.mtime;
      const rawExt = path.extname(filePath).toLowerCase();
      const ext = rawExt || '(other)';
      const name = path.basename(filePath);
      const relativePath = path.relative(resolvedDir, filePath);

      totalSize += size;

      const currentExtStats = extensionMap.get(ext) || { count: 0, totalSize: 0 };
      currentExtStats.count += 1;
      currentExtStats.totalSize += size;
      extensionMap.set(ext, currentExtStats);

      const daysOld = (now - mtime.getTime()) / DAY_MS;
      if (daysOld <= 7) {
        ageStats.last7Days += 1;
      }
      if (daysOld <= 30) {
        ageStats.last30Days += 1;
      }
      if (daysOld > 90) {
        ageStats.olderThan90Days += 1;
      }

      const fileMeta = {
        path: filePath,
        relativePath,
        name,
        size,
        mtime,
        ext,
        daysOld: Math.floor(daysOld)
      };

      allFilesMeta.push(fileMeta);

      if (!oldestFile || mtime.getTime() < oldestFile.mtime.getTime()) {
        oldestFile = fileMeta;
      }

      this.emit('file-found', {
        ...fileMeta,
        current: i + 1,
        total
      });
    }

    const byExtension = Array.from(extensionMap.entries())
      .map(([ext, data]) => ({
        ext,
        count: data.count,
        totalSize: data.totalSize
      }))
      .sort((a, b) => b.totalSize - a.totalSize || b.count - a.count);

    const largestFiles = [...allFilesMeta]
      .sort((a, b) => b.size - a.size)
      .slice(0, 3);

    const statistics = {
      directory: resolvedDir,
      totalFiles: total,
      totalSize,
      byExtension,
      extensionMap,
      ageStats,
      largestFiles,
      oldestFile
    };

    this.emit('scan-complete', statistics);
    return statistics;
  }
}
