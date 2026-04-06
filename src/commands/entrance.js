import { SlashCommandBuilder, PermissionFlagsBits } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { logger } from '../utils/logger.js';
import { probeDurationSeconds } from '../utils/audio-duration.js';
import { EntranceVoiceService } from '../services/entrance-voice-service.js';

const MAX_DURATION_SEC = 10;

function isEntranceAdmin(interaction) {
  // Strongest rule: explicit user id from env.
  const configuredAdminId = process.env.ENTRANCE_ADMIN_USER_ID?.trim();
  if (configuredAdminId) {
    return interaction.user.id === configuredAdminId;
  }

  // Fallback: server owner only.
  return interaction.guild && interaction.user.id === interaction.guild.ownerId;
}

function isAllowedAttachment(att) {
  const n = att.name?.toLowerCase() ?? '';
  if (n.endsWith('.mp3') || n.endsWith('.ogg')) return true;
  const ct = att.contentType ?? '';
  return ct.includes('audio/mpeg') || ct.includes('ogg');
}

function isHttpUrl(string) {
  try {
    const u = new URL(string);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

function botCanJoinAndSpeak(guild, channel) {
  const me = guild.members.me;
  if (!me) return false;
  const perms = channel.permissionsFor(me);
  return Boolean(
    perms?.has(PermissionFlagsBits.Connect) && perms.has(PermissionFlagsBits.Speak)
  );
}

async function deleteStoredFileIfAny(store, guildId, userId) {
  const existing = store.get(guildId, userId);
  if (existing?.kind === 'file' && existing.path) {
    const abs = store.resolveAbsolutePath(existing);
    if (abs) {
      try {
        await fs.unlink(abs);
      } catch {
        // ignore
      }
    }
  }
}

export const entranceCommand = {
  data: new SlashCommandBuilder()
    .setName('entrance')
    .setDescription('Manage per-user voice entrance sounds (Manage Server)')
    .addSubcommand((sub) =>
      sub
        .setName('set')
        .setDescription('Assign or update an entrance sound for a user')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
        .addStringOption((o) =>
          o
            .setName('url')
            .setDescription('Direct URL to MP3 or OGG (HTTPS)')
            .setRequired(false)
        )
        .addAttachmentOption((o) =>
          o.setName('file').setDescription('MP3 or OGG attachment').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('remove')
        .setDescription('Remove a user entrance sound')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
    )
    .addSubcommand((sub) => sub.setName('list').setDescription('List configured entrance sounds'))
    .addSubcommand((sub) =>
      sub
        .setName('test')
        .setDescription('Play a user entrance sound in your current voice channel')
        .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),

  /**
   * @param {import('discord.js').ChatInputCommandInteraction} interaction
   * @param {import('../utils/entrance-sound-store.js').EntranceSoundStore} store
   * @param {import('../services/entrance-voice-service.js').EntranceVoiceService} voiceService
   */
  async execute(interaction, store, voiceService) {
    if (!interaction.guild) {
      await interaction.reply({
        content: 'This command can only be used in a server.',
        ephemeral: true
      });
      return;
    }

    if (!isEntranceAdmin(interaction)) {
      await interaction.reply({
        content: 'Only the configured entrance admin can use this command.',
        ephemeral: true
      });
      return;
    }

    const guildId = interaction.guild.id;
    const sub = interaction.options.getSubcommand(true);

    if (sub === 'set') {
      const user = interaction.options.getUser('user', true);
      const url = interaction.options.getString('url');
      const file = interaction.options.getAttachment('file');

      if ((url && file) || (!url && !file)) {
        await interaction.reply({
          content: 'Provide either a **url** or a **file** attachment, not both and not neither.',
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        if (file) {
          if (!isAllowedAttachment(file)) {
            await interaction.editReply('Attachment must be **MP3** or **OGG**.');
            return;
          }

          const duration = await probeDurationSeconds(file.url);
          if (duration == null) {
            await interaction.editReply(
              'Could not read audio duration (is **ffprobe** installed and on PATH?).'
            );
            return;
          }
          if (duration > MAX_DURATION_SEC) {
            await interaction.editReply(
              `Clip is **${duration.toFixed(1)}s**; maximum allowed is **${MAX_DURATION_SEC}s**.`
            );
            return;
          }

          await deleteStoredFileIfAny(store, guildId, user.id);
          await store.ensureAudioDir(guildId, user.id);

          const ext = file.name?.toLowerCase().endsWith('.ogg') ? 'ogg' : 'mp3';
          const relPath = path.posix.join(
            'data',
            'entrance-audio',
            guildId,
            `${user.id}.${ext}`
          );
          const absPath = path.join(store.projectRoot, relPath);

          const res = await axios.get(file.url, {
            responseType: 'arraybuffer',
            timeout: 60_000,
            maxContentLength: 25 * 1024 * 1024,
            maxBodyLength: 25 * 1024 * 1024
          });
          await fs.writeFile(absPath, Buffer.from(res.data));
          await store.setFile(guildId, user.id, relPath);

          await interaction.editReply(`Entrance sound updated for **${user.tag}** (file, ${duration.toFixed(1)}s).`);
          return;
        }

        if (!isHttpUrl(url)) {
          await interaction.editReply('URL must start with **http://** or **https://**.');
          return;
        }

        const duration = await probeDurationSeconds(url.trim());
        if (duration == null) {
          await interaction.editReply(
            'Could not read duration for that URL (check the link and **ffprobe**).'
          );
          return;
        }
        if (duration > MAX_DURATION_SEC) {
          await interaction.editReply(
            `Remote clip is **${duration.toFixed(1)}s**; maximum allowed is **${MAX_DURATION_SEC}s**.`
          );
          return;
        }

        await deleteStoredFileIfAny(store, guildId, user.id);
        await store.setUrl(guildId, user.id, url.trim());

        await interaction.editReply(`Entrance sound updated for **${user.tag}** (URL, ${duration.toFixed(1)}s).`);
      } catch (error) {
        logger.error('entrance set:', error);
        await interaction.editReply('Failed to save that entrance sound.');
      }
      return;
    }

    if (sub === 'remove') {
      const user = interaction.options.getUser('user', true);
      const removed = await store.remove(guildId, user.id);
      await interaction.reply({
        content: removed
          ? `Removed entrance sound for **${user.tag}**.`
          : `**${user.tag}** had no entrance sound configured.`,
        ephemeral: true
      });
      return;
    }

    if (sub === 'list') {
      const map = store.getAllForGuild(guildId);
      const ids = Object.keys(map);
      if (ids.length === 0) {
        await interaction.reply({
          content: 'No entrance sounds configured in this server.',
          ephemeral: true
        });
        return;
      }

      const lines = await Promise.all(
        ids.map(async (id) => {
          const u = await interaction.client.users.fetch(id).catch(() => null);
          const label = u ? `${u.tag} (\`${id}\`)` : `\`${id}\``;
          const src = map[id].kind === 'url' ? 'URL' : 'file';
          return `• ${label} — ${src}`;
        })
      );

      await interaction.reply({
        content: `**Entrance sounds (${ids.length})**\n${lines.join('\n')}`,
        ephemeral: true
      });
      return;
    }

    if (sub === 'test') {
      const user = interaction.options.getUser('user', true);
      const channel = interaction.member?.voice?.channel;
      if (!channel) {
        await interaction.reply({
          content: 'Join a **voice channel** first so the bot knows where to play the preview.',
          ephemeral: true
        });
        return;
      }

      const entry = store.get(guildId, user.id);
      if (!entry) {
        await interaction.reply({
          content: `**${user.tag}** has no entrance sound configured.`,
          ephemeral: true
        });
        return;
      }

      if (!botCanJoinAndSpeak(interaction.guild, channel)) {
        await interaction.reply({
          content: 'I need **Connect** and **Speak** permissions in your current voice channel.',
          ephemeral: true
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const result = await voiceService.enqueue(interaction.guild, channel.id, () =>
        EntranceVoiceService.createResourceFromStoreEntry(entry, store)
      );

      if (!result.ok && result.reason === 'different_channel') {
        await interaction.editReply(
          'The bot is already in another voice channel in this server; preview was skipped so existing playback is not interrupted.'
        );
        return;
      }
      if (!result.ok && result.reason === 'connection_in_use') {
        await interaction.editReply(
          'The current voice connection is owned by another service/player, so preview was skipped to avoid interruption.'
        );
        return;
      }
      if (!result.ok && result.reason === 'connect_failed') {
        await interaction.editReply(
          'I could not connect to that voice channel. Check channel permissions and try again.'
        );
        return;
      }

      await interaction.editReply(`Playing **${user.tag}**'s entrance sound in **${channel.name}**.`);
    }
  }
};
