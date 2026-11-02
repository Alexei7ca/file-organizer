import { EventEmitter } from 'events';
import crypto from 'crypto';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { collectFilesRecursively } from './scanner.js';

/**
 * Calculates the SHA-256 hash of a file using Node.js readable streams.
 * Never loads the entire file into memory at once.
 * @param {string} filePath
 * @returns {Promise<string>}
 */
export function calculateHash(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * DuplicateFinder class extending EventEmitter for streaming SHA-256 duplicate detection.
 */
export class DuplicateFinder extends EventEmitter {
  /**
   * Finds duplicate files by content hash inside a directory.
   * @param {string} directory
   * @returns {Promise<object>}
   */
  async findDuplicates(directory) {
    const resolvedDir = path.resolve(directory);
    const baseDisplayDir = path.basename(resolvedDir);
    const filePaths = await collectFilesRecursively(resolvedDir);
    const totalFiles = filePaths.length;

    this.emit('search-start', {
      directory: resolvedDir,
      totalFiles
    });

    const hashGroups = new Map();

    for (let i = 0; i < totalFiles; i++) {
      const filePath = filePaths[i];
      const stats = await fsPromises.stat(filePath);
      const hash = await calculateHash(filePath);

      const relFromParent = path.join(
        baseDisplayDir,
        path.relative(resolvedDir, filePath)
      );

      if (!hashGroups.has(hash)) {
        hashGroups.set(hash, {
          hash,
          size: stats.size,
          files: [],
          displayFiles: []
        });
      }

      const group = hashGroups.get(hash);
      group.files.push(filePath);
      group.displayFiles.push(relFromParent);

      this.emit('file-processed', {
        filePath,
        hash,
        current: i + 1,
        total: totalFiles
      });
    }

    const groups = [];
    let totalWastedSpace = 0;

    for (const group of hashGroups.values()) {
      if (group.files.length > 1) {
        const wastedSpace = group.size * (group.files.length - 1);
        totalWastedSpace += wastedSpace;
        groups.push({
          ...group,
          copies: group.files.length,
          wastedSpace
        });
      }
    }

    groups.sort((a, b) => b.wastedSpace - a.wastedSpace);

    const result = {
      directory: resolvedDir,
      groups,
      totalGroups: groups.length,
      totalWastedSpace,
      totalFiles
    };

    this.emit('duplicates-found', result);
    return result;
  }
}
