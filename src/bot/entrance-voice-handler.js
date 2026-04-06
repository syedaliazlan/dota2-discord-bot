import { Events, PermissionFlagsBits } from 'discord.js';
import { logger } from '../utils/logger.js';
import { EntranceVoiceService } from '../services/entrance-voice-service.js';

const JOIN_DEBOUNCE_MS = 400;

/**
 * Debounced voice join / channel move → play entrance sound if configured.
 * See https://discordjs.guide/voice/voice-connections (GuildVoiceStates intent).
 */
export function registerEntranceVoiceHandler(client, store, voiceService) {
  /** @type {Map<string, NodeJS.Timeout>} */
  const timeouts = new Map();

  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const member = newState.member;
    if (!member || member.user.bot) return;

    const guildId = newState.guild.id;
    const userId = newState.id;
    const timeoutKey = `${guildId}:${userId}`;

    if (!newState.channelId) return;
    if (oldState.channelId === newState.channelId) return;

    const entry = store.get(guildId, userId);
    if (!entry) return;

    const existing = timeouts.get(timeoutKey);
    if (existing) clearTimeout(existing);

    const t = setTimeout(() => {
      timeouts.delete(timeoutKey);
      const vs = newState.guild.voiceStates.cache.get(userId);
      if (!vs?.channelId) return;
      const channel = vs.channel;
      if (!channel) return;

      const me = newState.guild.members.me;
      if (!me) return;
      const perms = channel.permissionsFor(me);
      if (!perms?.has(PermissionFlagsBits.Connect) || !perms.has(PermissionFlagsBits.Speak)) {
        logger.debug(
          `Entrance skipped for ${userId}: missing Connect/Speak in channel ${channel.id}`
        );
        return;
      }

      void (async () => {
        const result = await voiceService.enqueue(newState.guild, channel.id, () =>
          EntranceVoiceService.createResourceFromStoreEntry(entry, store)
        );
        if (!result.ok && result.reason === 'different_channel') {
          logger.debug(`Entrance skipped for ${userId}: bot busy in another voice channel`);
        } else if (!result.ok && result.reason === 'connection_in_use') {
          logger.debug(`Entrance skipped for ${userId}: connection owned by another player/service`);
        } else if (!result.ok && result.reason === 'connect_failed') {
          logger.debug(`Entrance skipped for ${userId}: voice connection failed`);
        }
      })();
    }, JOIN_DEBOUNCE_MS);

    timeouts.set(timeoutKey, t);
  });
}
