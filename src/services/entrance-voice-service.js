import {
  joinVoiceChannel,
  getVoiceConnection,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  demuxProbe,
  generateDependencyReport
} from '@discordjs/voice';
import { createReadStream } from 'node:fs';
import axios from 'axios';
import { logger } from '../utils/logger.js';

/**
 * Plays short entrance clips using @discordjs/voice patterns from:
 * https://discordjs.guide/voice/voice-connections
 * https://discordjs.guide/voice/audio-player
 * https://discordjs.guide/voice/audio-resources
 *
 * Important: calling joinVoiceChannel while already connected in the same guild
 * moves the bot to the new channel — so we skip if already connected elsewhere.
 */
export class EntranceVoiceService {
  constructor() {
    /** @type {Map<string, { player: import('@discordjs/voice').AudioPlayer, queue: Array<() => Promise<import('@discordjs/voice').AudioResource>> }>} */
    this._guilds = new Map();
  }

  logDependencyReport() {
    try {
      logger.info(`Voice deps:\n${generateDependencyReport()}`);
    } catch (e) {
      logger.warn('Could not generate voice dependency report:', e.message);
    }
  }

  /**
   * @param {import('discord.js').Guild} guild
   * @param {string} channelId
   * @param {() => Promise<import('@discordjs/voice').AudioResource>} resourceFactory
   * @returns {Promise<{ ok: boolean, reason?: string }>}
   */
  async enqueue(guild, channelId, resourceFactory) {
    let state = this._guilds.get(guild.id);
    const existing = getVoiceConnection(guild.id);

    // If another feature created a connection in this guild, never hijack it.
    if (existing && !state) {
      logger.debug(`Entrance sound skipped: voice connection already in use for guild ${guild.id}`);
      return { ok: false, reason: 'connection_in_use' };
    }

    if (existing && existing.joinConfig.channelId !== channelId) {
      logger.debug(
        `Entrance sound skipped: bot in channel ${existing.joinConfig.channelId}, user joined ${channelId}`
      );
      return { ok: false, reason: 'different_channel' };
    }

    let connection = existing;
    if (!connection) {
      connection = joinVoiceChannel({
        channelId,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: false
      });
    }

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 8_000);
    } catch (error) {
      logger.warn(`Entrance sound connect failed in guild ${guild.id}: ${error.message || error}`);
      this._guilds.delete(guild.id);
      try {
        connection.destroy();
      } catch {
        // ignore
      }
      return { ok: false, reason: 'connect_failed' };
    }

    if (!state) {
      const player = createAudioPlayer();
      connection.subscribe(player);

      state = {
        player,
        queue: []
      };
      this._guilds.set(guild.id, state);

      player.on('error', (error) => {
        logger.error(`Entrance audio player error: ${error.message}`);
      });

      player.on(AudioPlayerStatus.Idle, () => {
        void this._onPlayerIdle(guild.id);
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
          ]);
        } catch {
          this._guilds.delete(guild.id);
          try {
            connection.destroy();
          } catch {
            // ignore
          }
        }
      });
    } else {
      connection.subscribe(state.player);
    }

    state.queue.push(resourceFactory);

    if (state.player.state.status === AudioPlayerStatus.Idle) {
      await this._playNext(guild.id);
    }

    return { ok: true };
  }

  /**
   * @param {{ kind: string, path?: string, url?: string }} entry
   * @param {import('../utils/entrance-sound-store.js').EntranceSoundStore} store
   */
  static async createResourceFromStoreEntry(entry, store) {
    if (entry.kind === 'file') {
      const abs = store.resolveAbsolutePath(entry);
      if (!abs) throw new Error('Invalid file entry');
      const { stream, type } = await demuxProbe(createReadStream(abs));
      return createAudioResource(stream, { inputType: type });
    }

    const response = await axios.get(entry.url, {
      responseType: 'stream',
      timeout: 45_000,
      maxContentLength: 25 * 1024 * 1024,
      maxBodyLength: 25 * 1024 * 1024,
      validateStatus: (s) => s >= 200 && s < 300
    });
    const { stream, type } = await demuxProbe(response.data);
    return createAudioResource(stream, { inputType: type });
  }

  async _onPlayerIdle(guildId) {
    const state = this._guilds.get(guildId);
    if (!state) return;

    if (state.queue.length > 0) {
      await this._playNext(guildId);
      return;
    }

    const connection = getVoiceConnection(guildId);
    if (connection) {
      this._guilds.delete(guildId);
      try {
        connection.destroy();
      } catch (e) {
        logger.warn('Error destroying voice connection:', e.message);
      }
    } else {
      this._guilds.delete(guildId);
    }
  }

  async _playNext(guildId) {
    const state = this._guilds.get(guildId);
    if (!state || state.queue.length === 0) return;

    const factory = state.queue.shift();
    try {
      const resource = await factory();
      state.player.play(resource);
    } catch (error) {
      logger.error('Entrance play failed:', error.message || error);
      await this._onPlayerIdle(guildId);
    }
  }

  destroyAll() {
    for (const id of this._guilds.keys()) {
      const c = getVoiceConnection(id);
      if (c) {
        try {
          c.destroy();
        } catch {
          // ignore
        }
      }
    }
    this._guilds.clear();
  }
}
