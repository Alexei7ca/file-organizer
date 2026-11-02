import { EventEmitter } from 'events';
import fs from 'fs/promises';
import path from 'path';
import { collectFilesRecursively } from './scanner.js';

const DAY_MS = 1000 * 60 * 60 * 24;

/**
 * Formats a Date instance into YYYY-MM-DD.
 * @param {Date} date
 * @returns {string}
 */
export function formatDateISO(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Cleanup class extending EventEmitter for age-based file identification and deletion.
 */
export class Cleanup extends EventEmitter {
  /**
   * Finds files older than thresholdDays and optionally deletes them when confirmed is true.
   * @param {string} directory
   * @param {number} thresholdDays
   * @param {boolean} confirmed
   * @returns {Promise<object>}
   */
  async clean(directory, thresholdDays, confirmed = false) {
    const resolvedDir = path.resolve(directory);
    const filePaths = await collectFilesRecursively(resolvedDir);
    const now = Date.now();

    const candidateFiles = [];
    let totalSize = 0;

    for (const filePath of filePaths) {
      const stats = await fs.stat(filePath);
      const fileAge = now - stats.mtime.getTime();
      const daysOld = fileAge / DAY_MS;

      if (daysOld > thresholdDays) {
        const candidate = {
          path: filePath,
          relativePath: path.relative(resolvedDir, filePath),
          name: path.basename(filePath),
          size: stats.size,
          mtime: stats.mtime,
          modifiedDate: formatDateISO(stats.mtime),
          daysOld: Math.floor(daysOld)
        };
        candidateFiles.push(candidate);
        totalSize += stats.size;
        this.emit('file-found', candidate);
      }
    }

    candidateFiles.sort((a, b) => b.daysOld - a.daysOld);

    let deletedCount = 0;
    let freedSize = 0;

    if (confirmed && candidateFiles.length > 0) {
      const totalToDelete = candidateFiles.length;
      for (let i = 0; i < totalToDelete; i++) {
        const file = candidateFiles[i];
        await fs.unlink(file.path);
        deletedCount += 1;
        freedSize += file.size;

        this.emit('file-deleted', {
          path: file.path,
          name: file.name,
          size: file.size,
          current: i + 1,
          total: totalToDelete
        });
      }
    }

    const result = {
      directory: resolvedDir,
      thresholdDays,
      confirmed,
      files: candidateFiles,
      totalFiles: candidateFiles.length,
      totalSize,
      deletedCount,
      freedSize
    };

    this.emit('cleanup-complete', result);
    return result;
  }
}
