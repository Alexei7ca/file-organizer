import { EventEmitter } from 'events';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';
import { pipeline } from 'stream/promises';
import { collectFilesRecursively } from './scanner.js';

export const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10 MB

export const categories = {
  Documents: ['.pdf', '.docx', '.doc', '.txt', '.md', '.xlsx', '.pptx'],
  Images: ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.bmp'],
  Archives: ['.zip', '.rar', '.tar', '.gz', '.7z'],
  Code: ['.js', '.py', '.java', '.cpp', '.html', '.css', '.json'],
  Videos: ['.mp4', '.avi', '.mkv', '.mov', '.webm'],
  Other: []
};

/**
 * Determines the category name for a given file path based on its extension.
 * @param {string} filePath
 * @returns {string}
 */
export function getCategoryForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  for (const [category, extensions] of Object.entries(categories)) {
    if (category !== 'Other' && extensions.includes(ext)) {
      return category;
    }
  }
  return 'Other';
}

/**
 * Resolves filename collisions by appending (1), (2), etc. before the file extension.
 * @param {string} targetDir
 * @param {string} originalFileName
 * @returns {Promise<string>}
 */
export async function resolveUniqueTargetPath(targetDir, originalFileName) {
  const ext = path.extname(originalFileName);
  const baseName = path.basename(originalFileName, ext);
  let candidatePath = path.join(targetDir, originalFileName);
  let counter = 1;

  while (true) {
    try {
      await fsPromises.access(candidatePath);
      candidatePath = path.join(targetDir, `${baseName}(${counter})${ext}`);
      counter += 1;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return candidatePath;
      }
      throw error;
    }
  }
}

/**
 * Organizer class extending EventEmitter for non-destructive categorized file copying.
 */
export class Organizer extends EventEmitter {
  /**
   * Organizes files from sourceDir into categorized folders inside targetDir.
   * @param {string} sourceDir
   * @param {string} targetDir
   * @returns {Promise<object>}
   */
  async organize(sourceDir, targetDir) {
    const resolvedSource = path.resolve(sourceDir);
    const resolvedTarget = path.resolve(targetDir);

    const filePaths = await collectFilesRecursively(
      resolvedSource,
      resolvedTarget
    );
    const total = filePaths.length;

    const summary = {};
    for (const category of Object.keys(categories)) {
      const categoryFolder = path.join(resolvedTarget, category);
      await fsPromises.mkdir(categoryFolder, { recursive: true });
      summary[category] = { count: 0, size: 0, folderPath: categoryFolder };
      this.emit('folder-created', {
        category,
        folderPath: categoryFolder
      });
    }

    let totalCopied = 0;
    let totalSize = 0;

    for (let i = 0; i < total; i++) {
      const sourcePath = filePaths[i];
      const stats = await fsPromises.stat(sourcePath);
      const size = stats.size;
      const category = getCategoryForFile(sourcePath);
      const categoryDir = path.join(resolvedTarget, category);
      const targetPath = await resolveUniqueTargetPath(
        categoryDir,
        path.basename(sourcePath)
      );

      this.emit('copy-start', {
        sourcePath,
        targetPath,
        category,
        size,
        current: i + 1,
        total
      });

      try {
        const usedStream = size >= LARGE_FILE_THRESHOLD;
        if (usedStream) {
          await pipeline(
            fs.createReadStream(sourcePath),
            fs.createWriteStream(targetPath)
          );
        } else {
          await fsPromises.copyFile(sourcePath, targetPath);
        }

        summary[category].count += 1;
        summary[category].size += size;
        totalCopied += 1;
        totalSize += size;

        this.emit('copy-complete', {
          sourcePath,
          targetPath,
          category,
          size,
          usedStream,
          current: i + 1,
          total
        });
      } catch (error) {
        this.emit('copy-error', { sourcePath, error });
        throw error;
      }
    }

    const result = {
      sourceDir: resolvedSource,
      targetDir: resolvedTarget,
      summary,
      totalCopied,
      totalSize
    };

    this.emit('organize-complete', result);
    return result;
  }
}
