import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

/**
 * Per-guild Discord user id -> entrance sound metadata.
 * File entries use paths relative to project root (data/entrance-audio/...).
 */
export class EntranceSoundStore {
  constructor(storePath, projectRoot = process.cwd()) {
    this.storePath = storePath;
    this.projectRoot = projectRoot;
    this.data = { guilds: {} };
  }

  async load() {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });

      const raw = await fs.readFile(this.storePath, 'utf-8');
      const loaded = JSON.parse(raw);
      this.data = {
        guilds: typeof loaded?.guilds === 'object' && loaded.guilds !== null ? loaded.guilds : {}
      };
      logger.info('Entrance sounds store loaded');
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('No entrance sounds file yet, starting empty');
      } else {
        logger.warn('Failed to load entrance sounds store:', error.message);
      }
    }
  }

  async save() {
    try {
      const dir = path.dirname(this.storePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.storePath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      logger.error('Failed to save entrance sounds store:', error.message);
    }
  }

  _guildUsers(guildId) {
    if (!this.data.guilds[guildId]) this.data.guilds[guildId] = { users: {} };
    if (!this.data.guilds[guildId].users) this.data.guilds[guildId].users = {};
    return this.data.guilds[guildId].users;
  }

  get(guildId, userId) {
    return this._guildUsers(guildId)[userId] || null;
  }

  getAllForGuild(guildId) {
    return { ...this._guildUsers(guildId) };
  }

  async setFile(guildId, userId, relativePath) {
    this._guildUsers(guildId)[userId] = { kind: 'file', path: relativePath };
    await this.save();
  }

  async setUrl(guildId, userId, url) {
    this._guildUsers(guildId)[userId] = { kind: 'url', url };
    await this.save();
  }

  /**
   * Remove mapping. If stored file, deletes it from disk (best effort).
   */
  async remove(guildId, userId) {
    const users = this._guildUsers(guildId);
    const entry = users[userId];
    if (!entry) return false;

    if (entry.kind === 'file' && entry.path) {
      const abs = path.join(this.projectRoot, entry.path);
      try {
        await fs.unlink(abs);
      } catch {
        // ignore missing file
      }
    }

    delete users[userId];
    if (Object.keys(users).length === 0) {
      delete this.data.guilds[guildId].users;
      if (Object.keys(this.data.guilds[guildId]).length === 0) {
        delete this.data.guilds[guildId];
      }
    }
    await this.save();
    return true;
  }

  resolveAbsolutePath(entry) {
    if (!entry || entry.kind !== 'file' || !entry.path) return null;
    return path.join(this.projectRoot, entry.path);
  }

  audioDirForMember(guildId, userId) {
    return path.join(this.projectRoot, 'data', 'entrance-audio', guildId, userId);
  }

  async ensureAudioDir(guildId, userId) {
    const dir = path.join(this.projectRoot, 'data', 'entrance-audio', guildId);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }
}
