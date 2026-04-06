import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

/**
 * Read audio duration in seconds using ffprobe (local path or URL).
 * Returns null if probing fails.
 */
export async function probeDurationSeconds(target) {
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format=duration',
        '-of',
        'default=noprint_wrappers=1:nokey=1',
        target
      ],
      { timeout: 45_000, maxBuffer: 1024 * 1024 }
    );
    const d = parseFloat(String(stdout).trim());
    if (Number.isNaN(d) || d < 0) return null;
    return d;
  } catch {
    return null;
  }
}
