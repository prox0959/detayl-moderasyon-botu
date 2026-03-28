// =============================================
//   PROX BOT - commands.js
//   Tüm slash komutlar bu dosyada tanımlanır
//   index.js tarafından import edilir
// =============================================
import {
  SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder,
  ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle,
  ModalBuilder, TextInputBuilder, TextInputStyle
} from 'discord.js';
import ms from 'ms';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __dirnameC = dirname(fileURLToPath(import.meta.url));
const _cfgC = JSON.parse(readFileSync(join(__dirnameC, 'id.json'), 'utf-8'));
Object.entries(_cfgC).forEach(([k, v]) => { process.env[k] = String(v); });

// ─── DB Yardımcıları (index.js'den gelir) ────
let _db, _saveDB, _addLog, _getGuild, _getUser;
export function initCommands(db, saveDB, addLog, getGuild, getUser) {
  _db = db; _saveDB = saveDB; _addLog = addLog;
  _getGuild = getGuild; _getUser = getUser;
}

// ─── Embed Yardımcıları ──────────────────────
export function successEmbed(title, desc) {
  return new EmbedBuilder().setColor(0x2ecc71).setTitle(`✅ ${title}`).setDescription(desc).setTimestamp();
}
export function errorEmbed(title, desc) {
  return new EmbedBuilder().setColor(0xe74c3c).setTitle(`❌ ${title}`).setDescription(desc).setTimestamp();
}
export function warnEmbed(title, desc) {
  return new EmbedBuilder().setColor(0xf39c12).setTitle(`⚠️ ${title}`).setDescription(desc).setTimestamp();
}
export function infoEmbed(title, desc) {
  return new EmbedBuilder().setColor(0x3498db).setTitle(`ℹ️ ${title}`).setDescription(desc).setTimestamp();
}
export function punishEmbed({ type, target, mod, reason, duration }) {
  const icons = { ban: '🔨', kick: '👢', mute: '🔇', warn: '⚠️', unban: '✅', unmute: '🔊' };
  const colors = { ban: 0xe74c3c, kick: 0xe67e22, mute: 0x3498db, warn: 0xf39c12 };
  const e = new EmbedBuilder()
    .setColor(colors[type] || 0x2c2f33)
    .setTitle(`${icons[type] || '🔧'} ${type.toUpperCase()}`)
    .addFields(
      { name: 'Kullanıcı', value: `<@${target.id}> (${target.tag})`, inline: true },
      { name: 'Yetkili',   value: `<@${mod.id}>`, inline: true },
      { name: 'Sebep',     value: reason || 'Belirtilmedi' },
    ).setThumbnail(target.displayAvatarURL()).setTimestamp();
  if (duration) e.addFields({ name: 'Süre', value: duration, inline: true });
  return e;
}

// ─── Log gönder ──────────────────────────────
async function sendLog(guild, discordGuild, embed) {
  const id = guild.channels?.log;
  if (!id) return;
  const ch = discordGuild.channels.cache.get(id);
  if (ch) await ch.send({ embeds: [embed] }).catch(() => {});
}

// =============================================
//   KOMUT TANIMLAMALARI
// =============================================
export const commands = [

  // ──────────────────────────────────────────
  //  /ban
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('ban').setDescription('Kullanıcıyı sunucudan yasaklar')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addUserOption(o => o.setName('kullanici').setDescription('Yasaklanacak kullanıcı').setRequired(true))
      .addStringOption(o => o.setName('sebep').setDescription('Sebep'))
      .addIntegerOption(o => o.setName('mesaj_sil').setDescription('Silinecek mesaj günü (0-7)').setMinValue(0).setMaxValue(7)),
    cooldown: 5,
    async execute(i) {
      const target = i.options.getMember('kullanici');
      const reason = i.options.getString('sebep') || 'Belirtilmedi';
      const days   = i.options.getInteger('mesaj_sil') ?? 1;
      if (!target?.bannable) return i.reply({ embeds: [errorEmbed('Hata', 'Bu kullanıcıyı banlayamam.')], ephemeral: true });
      if (target.id === i.user.id) return i.reply({ embeds: [errorEmbed('Hata', 'Kendini banlayamazsın.')], ephemeral: true });
      await target.ban({ reason, deleteMessageSeconds: days * 86400 });
      const ud = _getUser(target.id, i.guildId);
      ud.punishments.push({ type: 'ban', reason, mod: i.user.id, timestamp: Date.now() });
      _getUser(i.user.id, i.guildId).staffStats.bans++;
      await _saveDB();
      const embed = punishEmbed({ type: 'ban', target: target.user, mod: i.user, reason });
      await i.reply({ embeds: [embed] });
      await sendLog(_getGuild(i.guildId), i.guild, embed);
      await _addLog({ type: 'ban', guildId: i.guildId, targetId: target.id, modId: i.user.id, reason });
    }
  },

  // ──────────────────────────────────────────
  //  /unban
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('unban').setDescription('Banlı kullanıcının yasağını kaldırır')
      .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
      .addStringOption(o => o.setName('kullanici_id').setDescription('Kullanıcı ID').setRequired(true))
      .addStringOption(o => o.setName('sebep').setDescription('Sebep')),
    cooldown: 5,
    async execute(i) {
      const uid    = i.options.getString('kullanici_id');
      const reason = i.options.getString('sebep') || 'Belirtilmedi';
      await i.guild.members.unban(uid, reason).catch(() => {});
      await _saveDB();
      await i.reply({ embeds: [successEmbed('Unban', `<@${uid}> yasağı kaldırıldı.\n**Sebep:** ${reason}`)] });
      await _addLog({ type: 'unban', guildId: i.guildId, targetId: uid, modId: i.user.id, reason });
    }
  },

  // ──────────────────────────────────────────
  //  /kick
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('kick').setDescription('Kullanıcıyı sunucudan atar')
      .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
      .addUserOption(o => o.setName('kullanici').setDescription('Atılacak kullanıcı').setRequired(true))
      .addStringOption(o => o.setName('sebep').setDescription('Sebep')),
    cooldown: 5,
    async execute(i) {
      const target = i.options.getMember('kullanici');
      const reason = i.options.getString('sebep') || 'Belirtilmedi';
      if (!target?.kickable) return i.reply({ embeds: [errorEmbed('Hata', 'Bu kullanıcıyı atamam.')], ephemeral: true });
      await target.kick(reason);
      const ud = _getUser(target.id, i.guildId);
      ud.punishments.push({ type: 'kick', reason, mod: i.user.id, timestamp: Date.now() });
      _getUser(i.user.id, i.guildId).staffStats.kicks++;
      await _saveDB();
      const embed = punishEmbed({ type: 'kick', target: target.user, mod: i.user, reason });
      await i.reply({ embeds: [embed] });
      await sendLog(_getGuild(i.guildId), i.guild, embed);
      await _addLog({ type: 'kick', guildId: i.guildId, targetId: target.id, modId: i.user.id, reason });
    }
  },

  // ──────────────────────────────────────────
  //  /mute
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('mute').setDescription('Kullanıcıyı timeout ile susturur')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('kullanici').setDescription('Susturulacak kullanıcı').setRequired(true))
      .addStringOption(o => o.setName('sure').setDescription('Süre: 10m, 1h, 1d').setRequired(true))
      .addStringOption(o => o.setName('sebep').setDescription('Sebep')),
    cooldown: 3,
    async execute(i) {
      const target  = i.options.getMember('kullanici');
      const sureStr = i.options.getString('sure');
      const reason  = i.options.getString('sebep') || 'Belirtilmedi';
      const msVal   = ms(sureStr);
      if (!msVal) return i.reply({ embeds: [errorEmbed('Hata', 'Geçersiz süre. Örn: `10m`, `1h`, `1d`')], ephemeral: true });
      if (!target) return i.reply({ embeds: [errorEmbed('Hata', 'Kullanıcı bulunamadı.')], ephemeral: true });
      await target.timeout(msVal, reason);
      const ud = _getUser(target.id, i.guildId);
      ud.punishments.push({ type: 'mute', reason, duration: sureStr, mod: i.user.id, timestamp: Date.now() });
      _getUser(i.user.id, i.guildId).staffStats.mutes++;
      await _saveDB();
      const embed = punishEmbed({ type: 'mute', target: target.user, mod: i.user, reason, duration: sureStr });
      await i.reply({ embeds: [embed] });
      await sendLog(_getGuild(i.guildId), i.guild, embed);
      await _addLog({ type: 'mute', guildId: i.guildId, targetId: target.id, modId: i.user.id, reason, duration: sureStr });
    }
  },

  // ──────────────────────────────────────────
  //  /unmute
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('unmute').setDescription('Kullanıcının timeout\'unu kaldırır')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
      .addStringOption(o => o.setName('sebep').setDescription('Sebep')),
    cooldown: 3,
    async execute(i) {
      const target = i.options.getMember('kullanici');
      const reason = i.options.getString('sebep') || 'Belirtilmedi';
      if (!target) return i.reply({ embeds: [errorEmbed('Hata', 'Kullanıcı bulunamadı.')], ephemeral: true });
      await target.timeout(null, reason);
      await i.reply({ embeds: [successEmbed('Unmute', `${target.user.tag} susturması kaldırıldı.`)] });
      await _addLog({ type: 'unmute', guildId: i.guildId, targetId: target.id, modId: i.user.id, reason });
    }
  },

  // ──────────────────────────────────────────
  //  /uyar
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('uyar').setDescription('Kullanıcıyı uyarır')
      .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
      .addUserOption(o => o.setName('kullanici').setDescription('Uyarılacak kullanıcı').setRequired(true))
      .addStringOption(o => o.setName('sebep').setDescription('Sebep').setRequired(true)),
    cooldown: 3,
    async execute(i) {
      const target = i.options.getMember('kullanici');
      const reason = i.options.getString('sebep');
      if (!target) return i.reply({ embeds: [errorEmbed('Hata', 'Kullanıcı bulunamadı.')], ephemeral: true });
      const ud = _getUser(target.id, i.guildId);
      ud.punishments.push({ type: 'warn', reason, mod: i.user.id, timestamp: Date.now() });
      _getUser(i.user.id, i.guildId).staffStats.warns++;
      await _saveDB();
      const warnCount = ud.punishments.filter(p => p.type === 'warn').length;
      const embed = punishEmbed({ type: 'warn', target: target.user, mod: i.user, reason });
      embed.addFields({ name: 'Toplam Uyarı', value: `${warnCount}`, inline: true });
      await target.user.send({ embeds: [embed] }).catch(() => {});
      await i.reply({ embeds: [embed] });
      await sendLog(_getGuild(i.guildId), i.guild, embed);
      await _addLog({ type: 'warn', guildId: i.guildId, targetId: target.id, modId: i.user.id, reason });
    }
  },

  // ──────────────────────────────────────────
  //  /cezalar
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('cezalar').setDescription('Kullanıcının ceza geçmişini gösterir')
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)),
    cooldown: 5,
    async execute(i) {
      const target = i.options.getUser('kullanici');
      const ud = _getUser(target.id, i.guildId);
      const list = ud.punishments;
      if (!list.length) return i.reply({ embeds: [infoEmbed('Ceza Geçmişi', `${target.tag} için ceza kaydı bulunamadı.`)] });
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle(`📋 ${target.tag} — Ceza Geçmişi`)
        .setThumbnail(target.displayAvatarURL())
        .setDescription(list.slice(-10).reverse().map((p, idx) =>
          `**${idx + 1}.** \`${p.type.toUpperCase()}\` — ${p.reason}\n└ <@${p.mod}> • <t:${Math.floor(p.timestamp/1000)}:R>`
        ).join('\n\n'))
        .setFooter({ text: `Toplam ${list.length} ceza` })
        .setTimestamp();
      await i.reply({ embeds: [embed] });
    }
  },

  // ──────────────────────────────────────────
  //  /temizle
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('temizle').setDescription('Kanaldan mesaj siler')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
      .addIntegerOption(o => o.setName('miktar').setDescription('Silinecek mesaj sayısı (1-100)').setRequired(true).setMinValue(1).setMaxValue(100))
      .addUserOption(o => o.setName('kullanici').setDescription('Sadece bu kullanıcının mesajları')),
    cooldown: 5,
    async execute(i) {
      const miktar = i.options.getInteger('miktar');
      const target = i.options.getUser('kullanici');
      await i.deferReply({ ephemeral: true });
      const msgs = await i.channel.messages.fetch({ limit: 100 });
      let filtered = [...msgs.values()].slice(0, miktar);
      if (target) filtered = filtered.filter(m => m.author.id === target.id);
      const deleted = await i.channel.bulkDelete(filtered, true).catch(() => null);
      await i.editReply({ embeds: [successEmbed('Temizlendi', `**${deleted?.size || 0}** mesaj silindi.`)] });
    }
  },

  // ──────────────────────────────────────────
  //  /kayit
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('kayit').setDescription('Üyeyi kayıt eder')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addUserOption(o => o.setName('uye').setDescription('Kayıt edilecek üye').setRequired(true))
      .addStringOption(o => o.setName('isim').setDescription('İsim').setRequired(true))
      .addIntegerOption(o => o.setName('yas').setDescription('Yaş').setRequired(true).setMinValue(13).setMaxValue(99))
      .addStringOption(o => o.setName('cinsiyet').setDescription('Cinsiyet').setRequired(true)
        .addChoices({ name: '👦 Erkek', value: 'erkek' }, { name: '👧 Kız', value: 'kadin' })),
    cooldown: 3,
    async execute(i) {
      const target   = i.options.getMember('uye');
      const isim     = i.options.getString('isim');
      const yas      = i.options.getInteger('yas');
      const cinsiyet = i.options.getString('cinsiyet');
      const guild    = _getGuild(i.guildId);
      if (!guild.systems.kayit) return i.reply({ embeds: [errorEmbed('Kapalı', 'Kayıt sistemi aktif değil.')], ephemeral: true });
      if (!target) return i.reply({ embeds: [errorEmbed('Hata', 'Üye bulunamadı.')], ephemeral: true });
      await target.setNickname(`${isim} | ${yas}`).catch(() => {});
      const rolId = cinsiyet === 'erkek' ? guild.roles.erkek : guild.roles.kadin;
      if (rolId) await target.roles.add(rolId).catch(() => {});
      if (guild.roles.kayitli) await target.roles.add(guild.roles.kayitli).catch(() => {});
      if (guild.roles.unregistered) await target.roles.remove(guild.roles.unregistered).catch(() => {});
      _getUser(i.user.id, i.guildId).staffStats.kayits++;
      await _saveDB();
      const embed = successEmbed('Kayıt Tamamlandı',
        `**Üye:** ${target}\n**İsim:** ${isim} | ${yas}\n**Cinsiyet:** ${cinsiyet === 'erkek' ? '👦 Erkek' : '👧 Kız'}\n**Yetkili:** ${i.user}`);
      await i.reply({ embeds: [embed] });
      const logCh = guild.channels.kayit || guild.channels.log;
      if (logCh) { const ch = i.guild.channels.cache.get(logCh); if (ch) await ch.send({ embeds: [embed] }); }
      await _addLog({ type: 'kayit', guildId: i.guildId, targetId: target.id, modId: i.user.id });
    }
  },

  // ──────────────────────────────────────────
  //  /setup
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('setup').setDescription('Bot kurulum ayarları')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addSubcommand(s => s.setName('log').setDescription('Log kanalı').addChannelOption(o => o.setName('kanal').setDescription('Kanal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s.setName('ticket').setDescription('Ticket kategori kanalı').addChannelOption(o => o.setName('kanal').setDescription('Kanal').setRequired(true)))
      .addSubcommand(s => s.setName('kayit').setDescription('Kayıt log kanalı').addChannelOption(o => o.setName('kanal').setDescription('Kanal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s.setName('yetkili-log').setDescription('Yetkili bildirim kanalı').addChannelOption(o => o.setName('kanal').setDescription('Kanal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s.setName('ses-log').setDescription('Ses log kanalı').addChannelOption(o => o.setName('kanal').setDescription('Kanal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
      .addSubcommand(s => s.setName('mute-rol').setDescription('Mute rolü').addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)))
      .addSubcommand(s => s.setName('kayitsiz-rol').setDescription('Kayıtsız rolü').addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)))
      .addSubcommand(s => s.setName('kayitli-rol').setDescription('Kayıtlı rolü').addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)))
      .addSubcommand(s => s.setName('erkek-rol').setDescription('Erkek rolü').addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)))
      .addSubcommand(s => s.setName('kadin-rol').setDescription('Kız rolü').addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)))
      .addSubcommand(s => s.setName('mod-rol').setDescription('Moderatör rolü').addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)))
      .addSubcommand(s => s.setName('bilgi').setDescription('Mevcut ayarları göster')),
    cooldown: 3,
    async execute(i) {
      const sub   = i.options.getSubcommand();
      const guild = _getGuild(i.guildId);
      if (sub === 'bilgi') {
        const c = guild.channels; const r = guild.roles;
        return i.reply({ embeds: [infoEmbed('⚙️ Sunucu Ayarları',
          `**Log:** ${c.log?`<#${c.log}>`:'—'}\n**Ticket:** ${c.ticket?`<#${c.ticket}>`:'—'}\n` +
          `**Kayıt Log:** ${c.kayit?`<#${c.kayit}>`:'—'}\n**Yetkili Log:** ${c.yetkiliLog?`<#${c.yetkiliLog}>`:'—'}\n` +
          `**Ses Log:** ${c.sesLog?`<#${c.sesLog}>`:'—'}\n**Mute Rol:** ${r.mute?`<@&${r.mute}>`:'—'}\n` +
          `**Kayıtsız:** ${r.unregistered?`<@&${r.unregistered}>`:'—'}\n**Kayıtlı:** ${r.kayitli?`<@&${r.kayitli}>`:'—'}\n` +
          `**Erkek:** ${r.erkek?`<@&${r.erkek}>`:'—'}\n**Kız:** ${r.kadin?`<@&${r.kadin}>`:'—'}\n**Mod:** ${r.mod?`<@&${r.mod}>`:'—'}`
        )], ephemeral: true });
      }
      const chSubs = { log:'log', ticket:'ticket', kayit:'kayit', 'yetkili-log':'yetkiliLog', 'ses-log':'sesLog' };
      const rSubs  = { 'mute-rol':'mute','kayitsiz-rol':'unregistered','kayitli-rol':'kayitli','erkek-rol':'erkek','kadin-rol':'kadin','mod-rol':'mod' };
      if (chSubs[sub]) {
        const ch = i.options.getChannel('kanal');
        guild.channels[chSubs[sub]] = ch.id; await _saveDB();
        return i.reply({ embeds: [successEmbed('Ayarlandı', `\`${sub}\` kanalı ${ch} olarak ayarlandı.`)], ephemeral: true });
      }
      if (rSubs[sub]) {
        const rol = i.options.getRole('rol');
        guild.roles[rSubs[sub]] = rol.id; await _saveDB();
        return i.reply({ embeds: [successEmbed('Ayarlandı', `\`${sub}\` rolü ${rol} olarak ayarlandı.`)], ephemeral: true });
      }
    }
  },

  // ──────────────────────────────────────────
  //  /sistem
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('sistem').setDescription('Sistemleri aç/kapat')
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .addStringOption(o => o.setName('sistem').setDescription('Sistem').setRequired(true)
        .addChoices(
          { name: 'Ticket', value: 'ticket' }, { name: 'Kayıt', value: 'kayit' },
          { name: 'Anti-Spam', value: 'antiSpam' }, { name: 'Blacklist', value: 'blacklist' },
          { name: 'Davet', value: 'davet' }, { name: 'Coin', value: 'coin' }, { name: 'Ses', value: 'ses' }
        ))
      .addBooleanOption(o => o.setName('durum').setDescription('Açık mı kapalı mı').setRequired(true)),
    cooldown: 3,
    async execute(i) {
      const sistem = i.options.getString('sistem');
      const durum  = i.options.getBoolean('durum');
      const guild  = _getGuild(i.guildId);
      guild.systems[sistem] = durum; await _saveDB();
      await i.reply({ embeds: [successEmbed('Sistem Güncellendi', `**${sistem}** sistemi **${durum ? 'açıldı ✅' : 'kapatıldı ❌'}**.`)] });
    }
  },

  // ──────────────────────────────────────────
  //  /ticket-panel
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('ticket-panel').setDescription('Ticket açma panelini gönderir')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    cooldown: 10,
    async execute(i) {
      const guild = _getGuild(i.guildId);
      if (!guild.systems.ticket) return i.reply({ embeds: [errorEmbed('Kapalı', 'Ticket sistemi aktif değil.')], ephemeral: true });
      const embed = new EmbedBuilder()
        .setColor(0x5865F2).setTitle('🎫 Destek Sistemi')
        .setDescription('Yardım almak, şikayet bildirmek veya satın alım yapmak için butona tıkla.\n\n> 🔵 Genel Destek\n> 🟡 Şikayet\n> 🟢 Satın Alım')
        .setFooter({ text: 'Prox Bot • Destek Sistemi' }).setTimestamp();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_create').setLabel('📩 Ticket Oluştur').setStyle(ButtonStyle.Primary)
      );
      await i.channel.send({ embeds: [embed], components: [row] });
      await i.reply({ embeds: [successEmbed('Başarılı', 'Panel gönderildi.')], ephemeral: true });
    }
  },

  // ──────────────────────────────────────────
  //  /stats
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('stats').setDescription('Kullanıcı istatistiklerini gösterir')
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')),
    cooldown: 5,
    async execute(i) {
      const target = i.options.getUser('kullanici') || i.user;
      const data   = _getUser(target.id, i.guildId);
      const embed  = new EmbedBuilder()
        .setColor(0x5865F2).setTitle(`📊 ${target.username} — İstatistikler`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: '💬 Mesaj',        value: `${data.stats.messages||0}`,       inline: true },
          { name: '🔊 Ses (dk)',     value: `${data.stats.voiceMinutes||0}`,   inline: true },
          { name: '💰 Coin',         value: `${data.coin||0}`,                 inline: true },
          { name: '📨 Davet',        value: `${data.stats.invites||0}`,        inline: true },
          { name: '⚠️ Uyarı',        value: `${data.punishments.filter(p=>p.type==='warn').length}`, inline: true },
          { name: '📋 Toplam Ceza',  value: `${data.punishments.length}`,      inline: true },
          { name: '\u200b', value: '**— Yetkili İstatistikleri —**' },
          { name: '✅ Kayıt', value: `${data.staffStats.kayits||0}`, inline: true },
          { name: '👢 Kick',  value: `${data.staffStats.kicks||0}`,  inline: true },
          { name: '🔨 Ban',   value: `${data.staffStats.bans||0}`,   inline: true },
          { name: '🔇 Mute',  value: `${data.staffStats.mutes||0}`,  inline: true },
          { name: '⚠️ Warn',  value: `${data.staffStats.warns||0}`,  inline: true },
          { name: '🎫 Ticket',value: `${data.staffStats.tickets||0}`,inline: true },
        ).setFooter({ text: 'Prox Bot' }).setTimestamp();
      await i.reply({ embeds: [embed] });
    }
  },

  // ──────────────────────────────────────────
  //  /coin
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('coin').setDescription('Coin sistemi')
      .addSubcommand(s => s.setName('bakiye').setDescription('Bakiye göster').addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')))
      .addSubcommand(s => s.setName('gunluk').setDescription('Günlük coin al'))
      .addSubcommand(s => s.setName('ver').setDescription('Coin ver')
        .addUserOption(o => o.setName('kullanici').setDescription('Kime').setRequired(true))
        .addIntegerOption(o => o.setName('miktar').setDescription('Miktar').setRequired(true).setMinValue(1)))
      .addSubcommand(s => s.setName('ekle').setDescription('Coin ekle [ADMIN]').setDescription('Kullanıcıya coin ekle')
        .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
        .addIntegerOption(o => o.setName('miktar').setDescription('Miktar').setRequired(true).setMinValue(1))),
    cooldown: 3,
    async execute(i) {
      const sub  = i.options.getSubcommand();
      const self = _getUser(i.user.id, i.guildId);
      const DAILY = Number(process.env.DAILY_COIN) || 100;

      if (sub === 'bakiye') {
        const target = i.options.getUser('kullanici') || i.user;
        const data   = _getUser(target.id, i.guildId);
        const embed  = new EmbedBuilder().setColor(0xf1c40f)
          .setTitle(`💰 ${target.username} — Coin`)
          .setThumbnail(target.displayAvatarURL())
          .addFields(
            { name: 'Mevcut',  value: `${data.coin||0} 💰`,      inline: true },
            { name: 'Toplam',  value: `${data.totalCoin||0} 💰`,  inline: true },
            { name: '🔥 Seri', value: `${data.daily?.streak||0} gün`, inline: true },
          ).setTimestamp();
        return i.reply({ embeds: [embed] });
      }

      if (sub === 'gunluk') {
        const now  = Date.now(); const last = self.daily?.lastClaim || 0;
        if (now - last < 86400000) {
          const kalan = Math.ceil((86400000 - (now - last)) / 3600000);
          return i.reply({ embeds: [errorEmbed('Cooldown', `Günlük coinini aldın! **${kalan}s** sonra tekrar dene.`)], ephemeral: true });
        }
        const streak = (now - last) < 172800000 ? (self.daily?.streak||0)+1 : 1;
        const bonus  = Math.min(streak*10, 200);
        const total  = DAILY + bonus;
        self.coin = (self.coin||0)+total; self.totalCoin = (self.totalCoin||0)+total;
        self.daily = { lastClaim: now, streak }; await _saveDB();
        return i.reply({ embeds: [successEmbed('Günlük Coin', `**+${total} 💰** aldın!\n🔥 Seri: **${streak} gün** (+${bonus} bonus)\n💰 Bakiye: **${self.coin}**`)] });
      }

      if (sub === 'ver') {
        const target = i.options.getUser('kullanici');
        const miktar = i.options.getInteger('miktar');
        if (target.id === i.user.id) return i.reply({ embeds: [errorEmbed('Hata', 'Kendine coin veremezsin.')], ephemeral: true });
        if ((self.coin||0) < miktar) return i.reply({ embeds: [errorEmbed('Yetersiz', `Yeterli coinín yok. (Bakiye: ${self.coin||0})`)], ephemeral: true });
        const rec = _getUser(target.id, i.guildId);
        self.coin = (self.coin||0)-miktar; rec.coin = (rec.coin||0)+miktar; await _saveDB();
        return i.reply({ embeds: [successEmbed('Transfer', `**${miktar} 💰** → ${target}\nKalan: **${self.coin}**`)] });
      }

      if (sub === 'ekle') {
        if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({ embeds: [errorEmbed('Yetki', 'Admin yetkisi gerekli.')], ephemeral: true });
        const target = i.options.getUser('kullanici');
        const miktar = i.options.getInteger('miktar');
        const rec = _getUser(target.id, i.guildId);
        rec.coin = (rec.coin||0)+miktar; rec.totalCoin = (rec.totalCoin||0)+miktar; await _saveDB();
        return i.reply({ embeds: [successEmbed('Coin Eklendi', `${target} kullanıcısına **${miktar} 💰** eklendi.`)] });
      }
    }
  },

  // ──────────────────────────────────────────
  //  /blacklist
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('blacklist').setDescription('Yasaklı kelime/kullanıcı yönetimi')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
      .addSubcommand(s => s.setName('ekle-kelime').setDescription('Yasaklı kelime ekle').addStringOption(o => o.setName('kelime').setDescription('Kelime').setRequired(true)))
      .addSubcommand(s => s.setName('sil-kelime').setDescription('Kelimeyi kaldır').addStringOption(o => o.setName('kelime').setDescription('Kelime').setRequired(true)))
      .addSubcommand(s => s.setName('ekle-kullanici').setDescription('Kullanıcı ekle').addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)).addStringOption(o => o.setName('sebep').setDescription('Sebep')))
      .addSubcommand(s => s.setName('sil-kullanici').setDescription('Kullanıcıyı kaldır').addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)))
      .addSubcommand(s => s.setName('liste').setDescription('Blacklist listesi')),
    cooldown: 3,
    async execute(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'ekle-kelime') {
        const k = i.options.getString('kelime').toLowerCase();
        if (_db.data.blacklist.find(b => b.guildId===i.guildId&&b.type==='word'&&b.value===k))
          return i.reply({ embeds: [errorEmbed('Zaten Var','Bu kelime zaten listede.')], ephemeral: true });
        _db.data.blacklist.push({ guildId:i.guildId, type:'word', value:k, addedBy:i.user.id, addedAt:Date.now() });
        await _saveDB(); return i.reply({ embeds: [successEmbed('Eklendi',`\`${k}\` blackliste eklendi.`)], ephemeral: true });
      }
      if (sub === 'sil-kelime') {
        const k = i.options.getString('kelime').toLowerCase();
        _db.data.blacklist = _db.data.blacklist.filter(b=>!(b.guildId===i.guildId&&b.type==='word'&&b.value===k));
        await _saveDB(); return i.reply({ embeds: [successEmbed('Silindi',`\`${k}\` kaldırıldı.`)], ephemeral: true });
      }
      if (sub === 'ekle-kullanici') {
        const t = i.options.getUser('kullanici'); const s = i.options.getString('sebep')||'Belirtilmedi';
        _db.data.blacklist.push({ guildId:i.guildId, type:'user', value:t.id, reason:s, addedBy:i.user.id, addedAt:Date.now() });
        await _saveDB(); return i.reply({ embeds: [successEmbed('Eklendi',`${t} blackliste alındı.`)], ephemeral: true });
      }
      if (sub === 'sil-kullanici') {
        const t = i.options.getUser('kullanici');
        _db.data.blacklist = _db.data.blacklist.filter(b=>!(b.guildId===i.guildId&&b.type==='user'&&b.value===t.id));
        await _saveDB(); return i.reply({ embeds: [successEmbed('Silindi',`${t} kaldırıldı.`)], ephemeral: true });
      }
      if (sub === 'liste') {
        const words = _db.data.blacklist.filter(b=>b.guildId===i.guildId&&b.type==='word');
        const users = _db.data.blacklist.filter(b=>b.guildId===i.guildId&&b.type==='user');
        return i.reply({ embeds: [new EmbedBuilder().setColor(0xe74c3c).setTitle('🚫 Blacklist')
          .addFields(
            { name:`Kelimeler (${words.length})`, value: words.length?words.map(w=>`\`${w.value}\``).join(', '):'Yok' },
            { name:`Kullanıcılar (${users.length})`, value: users.length?users.map(u=>`<@${u.value}>`).join(', '):'Yok' }
          ).setTimestamp()], ephemeral: true });
      }
    }
  },

  // ──────────────────────────────────────────
  //  /ses
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('ses').setDescription('Ses sistemi')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addSubcommand(s => s.setName('rol-ayarla').setDescription('Ses kanalı rolü').addRoleOption(o => o.setName('rol').setDescription('Rol').setRequired(true)))
      .addSubcommand(s => s.setName('toplanti-ac').setDescription('Toplantı modu (herkes mute)'))
      .addSubcommand(s => s.setName('toplanti-kapat').setDescription('Toplantı modunu kapat'))
      .addSubcommand(s => s.setName('bilgi').setDescription('Ses ayarlarını göster')),
    cooldown: 5,
    async execute(i) {
      const sub = i.options.getSubcommand(); const guild = _getGuild(i.guildId);
      if (sub === 'rol-ayarla') {
        const rol = i.options.getRole('rol'); guild.roles.sesRol = rol.id; guild.systems.ses = true; await _saveDB();
        return i.reply({ embeds: [successEmbed('Ayarlandı',`Ses rolü ${rol} olarak ayarlandı.`)] });
      }
      if (sub === 'toplanti-ac') {
        const members = i.guild.members.cache.filter(m=>m.voice.channel&&!m.user.bot);
        let count=0; for (const m of members.values()) { await m.voice.setMute(true).catch(()=>{}); count++; }
        guild.systems.meeting=true; await _saveDB();
        return i.reply({ embeds: [successEmbed('Toplantı Açıldı',`**${count} üye** susturuldu.`)] });
      }
      if (sub === 'toplanti-kapat') {
        const members = i.guild.members.cache.filter(m=>m.voice.channel&&!m.user.bot);
        for (const m of members.values()) await m.voice.setMute(false).catch(()=>{});
        guild.systems.meeting=false; await _saveDB();
        return i.reply({ embeds: [successEmbed('Toplantı Kapatıldı','Tüm üyelerin sesi açıldı.')] });
      }
      if (sub === 'bilgi') {
        return i.reply({ embeds: [infoEmbed('🔊 Ses Sistemi',
          `**Ses Rolü:** ${guild.roles.sesRol?`<@&${guild.roles.sesRol}>`:'—'}\n**Durum:** ${guild.systems.ses?'✅':'❌'}\n**Toplantı:** ${guild.systems.meeting?'🔴 Açık':'⚫ Kapalı'}`
        )], ephemeral: true });
      }
    }
  },

  // ──────────────────────────────────────────
  //  /cekilis
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('cekilis').setDescription('Çekiliş sistemi')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
      .addSubcommand(s => s.setName('baslat').setDescription('Çekiliş başlat')
        .addStringOption(o => o.setName('odul').setDescription('Ödül').setRequired(true))
        .addStringOption(o => o.setName('sure').setDescription('Süre: 10m, 1h, 1d').setRequired(true))
        .addIntegerOption(o => o.setName('kazanan').setDescription('Kazanan sayısı').setMinValue(1).setMaxValue(10)))
      .addSubcommand(s => s.setName('bitis').setDescription('Çekilişi erken bitir').addStringOption(o => o.setName('mesaj_id').setDescription('Mesaj ID').setRequired(true)))
      .addSubcommand(s => s.setName('liste').setDescription('Aktif çekilişleri göster')),
    cooldown: 5,
    async execute(i, client) {
      const sub = i.options.getSubcommand();
      if (sub === 'baslat') {
        const odul    = i.options.getString('odul');
        const sureStr = i.options.getString('sure');
        const kazanan = i.options.getInteger('kazanan')||1;
        const msVal   = ms(sureStr);
        if (!msVal) return i.reply({ embeds: [errorEmbed('Hata','Geçersiz süre. Örn: `10m`, `1h`, `1d`')], ephemeral: true });
        const bitis = Date.now()+msVal;
        const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('🎉 ÇEKİLİŞ')
          .setDescription(`**Ödül:** ${odul}\n**Kazanan:** ${kazanan} kişi\n**Bitiş:** <t:${Math.floor(bitis/1000)}:R>\n**Başlatan:** ${i.user}`)
          .setFooter({ text:'Katılmak için butona tıkla!' }).setTimestamp(bitis);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('giveaway_join').setLabel('🎉 Katıl').setStyle(ButtonStyle.Success)
        );
        await i.reply({ embeds: [successEmbed('Başladı','Çekiliş başlatıldı!')], ephemeral: true });
        const msg = await i.channel.send({ embeds: [embed], components: [row] });
        _db.data.giveaways[msg.id] = { messageId:msg.id, channelId:i.channelId, guildId:i.guildId, prize:odul, winnerCount:kazanan, endsAt:bitis, hostId:i.user.id, participants:[], ended:false };
        await _saveDB();
        setTimeout(() => endGiveaway(msg.id, i.channel), msVal);
      }
      if (sub === 'bitis') {
        const msgId = i.options.getString('mesaj_id');
        const ch = i.channel; await endGiveaway(msgId, ch);
        await i.reply({ embeds: [successEmbed('Bitti','Çekiliş sonlandırıldı.')], ephemeral: true });
      }
      if (sub === 'liste') {
        const active = Object.values(_db.data.giveaways).filter(g=>g.guildId===i.guildId&&!g.ended);
        if (!active.length) return i.reply({ embeds: [infoEmbed('Çekilişler','Aktif çekiliş yok.')], ephemeral: true });
        const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('🎉 Aktif Çekilişler')
          .setDescription(active.map(g=>`**${g.prize}** — <t:${Math.floor(g.endsAt/1000)}:R> — ${g.participants.length} katılımcı`).join('\n'))
          .setTimestamp();
        return i.reply({ embeds: [embed], ephemeral: true });
      }
    }
  },

  // ──────────────────────────────────────────
  //  /davet
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('davet').setDescription('Davet istatistikleri')
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')),
    cooldown: 5,
    async execute(i) {
      const target = i.options.getUser('kullanici') || i.user;
      const invData = _db.data.invites[i.guildId]?.[target.id] || { total:0, members:[] };
      const embed = new EmbedBuilder().setColor(0x3498db).setTitle(`📨 ${target.username} — Davetler`)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name:'Toplam Davet', value:`${invData.total}`, inline:true },
          { name:'Davet Edilen', value:`${invData.members?.length||0} kişi`, inline:true },
        ).setTimestamp();
      await i.reply({ embeds: [embed] });
    }
  },

  // ──────────────────────────────────────────
  //  /basvuru
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('basvuru').setDescription('Yetkili başvurusu yap'),
    cooldown: 300,
    async execute(i) {
      const key = `${i.guildId}_${i.user.id}`;
      const existing = _db.data.applications[key];
      if (existing?.status === 'pending') return i.reply({ embeds: [errorEmbed('Zaten Başvurdun','Bekleyen bir başvurun var.')], ephemeral: true });
      const modal = new ModalBuilder().setCustomId('basvuru_modal').setTitle('Yetkili Başvurusu');
      modal.addComponents(
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('yas').setLabel('Kaç yaşındasın?').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('tecrube').setLabel('Daha önce yetkili oldun mu?').setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('neden').setLabel('Neden yetkili olmak istiyorsun?').setStyle(TextInputStyle.Paragraph).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('zaman').setLabel('Günlük kaç saat aktif olabilirsin?').setStyle(TextInputStyle.Short).setRequired(true)),
        new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('ekstra').setLabel('Eklemek istediğin bir şey?').setStyle(TextInputStyle.Paragraph).setRequired(false)),
      );
      await i.showModal(modal);
    }
  },

  // ──────────────────────────────────────────
  //  /sunucu
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('sunucu').setDescription('Sunucu bilgilerini gösterir'),
    cooldown: 10,
    async execute(i) {
      const g = i.guild;
      await g.members.fetch();
      const embed = new EmbedBuilder().setColor(0x5865F2).setTitle(`🌐 ${g.name}`)
        .setThumbnail(g.iconURL())
        .addFields(
          { name:'👑 Sahip',       value:`<@${g.ownerId}>`,                                         inline:true },
          { name:'👥 Üyeler',      value:`${g.memberCount}`,                                         inline:true },
          { name:'📅 Oluşturulma', value:`<t:${Math.floor(g.createdTimestamp/1000)}:D>`,             inline:true },
          { name:'💬 Kanallar',    value:`${g.channels.cache.filter(c=>c.type===0).size}`,           inline:true },
          { name:'🎭 Roller',      value:`${g.roles.cache.size}`,                                    inline:true },
          { name:'😀 Emojiler',    value:`${g.emojis.cache.size}`,                                   inline:true },
          { name:'🤖 Botlar',      value:`${g.members.cache.filter(m=>m.user.bot).size}`,            inline:true },
          { name:'👤 İnsanlar',    value:`${g.members.cache.filter(m=>!m.user.bot).size}`,           inline:true },
          { name:'🔒 Doğrulama',   value:`${['Yok','Düşük','Orta','Yüksek','Çok Yüksek'][g.verificationLevel]}`, inline:true },
        ).setTimestamp();
      await i.reply({ embeds: [embed] });
    }
  },

  // ──────────────────────────────────────────
  //  /kullanici
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('kullanici').setDescription('Kullanıcı bilgilerini gösterir')
      .addUserOption(o => o.setName('kullanici').setDescription('Kullanıcı')),
    cooldown: 5,
    async execute(i) {
      const target = i.options.getMember('kullanici') || i.member;
      const user   = target.user;
      const embed  = new EmbedBuilder().setColor(0x3498db)
        .setTitle(`👤 ${user.tag}`).setThumbnail(user.displayAvatarURL({ size:256 }))
        .addFields(
          { name:'🆔 ID',          value:user.id,                                              inline:true },
          { name:'📅 Hesap Yaşı',  value:`<t:${Math.floor(user.createdTimestamp/1000)}:R>`,    inline:true },
          { name:'📥 Katılım',     value:`<t:${Math.floor(target.joinedTimestamp/1000)}:R>`,   inline:true },
          { name:'🎭 En Yüksek Rol', value:`${target.roles.highest}`,                          inline:true },
          { name:'📋 Roller',      value:target.roles.cache.filter(r=>r.id!==i.guildId).map(r=>`${r}`).join(' ')||'Yok', inline:false },
        ).setTimestamp();
      await i.reply({ embeds: [embed] });
    }
  },

  // ──────────────────────────────────────────
  //  /rol
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('rol').setDescription('Kullanıcıya rol ver/al')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
      .addSubcommand(s => s.setName('ver').setDescription('Rol ver').addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)).addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true)))
      .addSubcommand(s => s.setName('al').setDescription('Rol al').addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)).addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true))),
    cooldown: 3,
    async execute(i) {
      const sub    = i.options.getSubcommand();
      const target = i.options.getMember('kullanici');
      const rol    = i.options.getRole('rol');
      if (!target) return i.reply({ embeds:[errorEmbed('Hata','Kullanıcı bulunamadı.')], ephemeral:true });
      if (sub === 'ver') {
        await target.roles.add(rol).catch(()=>{});
        return i.reply({ embeds:[successEmbed('Rol Verildi',`${target} → ${rol} rolü verildi.`)] });
      }
      if (sub === 'al') {
        await target.roles.remove(rol).catch(()=>{});
        return i.reply({ embeds:[successEmbed('Rol Alındı',`${target} → ${rol} rolü alındı.`)] });
      }
    }
  },

  // ──────────────────────────────────────────
  //  /yavaslat
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('yavaslat').setDescription('Kanalda yavaş modu ayarlar')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addIntegerOption(o => o.setName('saniye').setDescription('Saniye (0=kapat)').setRequired(true).setMinValue(0).setMaxValue(21600)),
    cooldown: 5,
    async execute(i) {
      const sn = i.options.getInteger('saniye');
      await i.channel.setRateLimitPerUser(sn);
      await i.reply({ embeds:[sn===0?successEmbed('Yavaş Mod Kapatıldı','Yavaş mod devre dışı.'):successEmbed('Yavaş Mod','Yavaş mod **'+sn+'s** olarak ayarlandı.')] });
    }
  },

  // ──────────────────────────────────────────
  //  /kilit
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder()
      .setName('kilit').setDescription('Kanalı kilitler/açar')
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
      .addSubcommand(s=>s.setName('kapat').setDescription('Kanalı kilitle'))
      .addSubcommand(s=>s.setName('ac').setDescription('Kanalı aç')),
    cooldown: 5,
    async execute(i) {
      const sub = i.options.getSubcommand();
      if (sub === 'kapat') {
        await i.channel.permissionOverwrites.edit(i.guild.id, { SendMessages: false });
        await i.reply({ embeds:[warnEmbed('🔒 Kanal Kilitlendi','Bu kanal kilitlendi.')] });
      } else {
        await i.channel.permissionOverwrites.edit(i.guild.id, { SendMessages: null });
        await i.reply({ embeds:[successEmbed('🔓 Kanal Açıldı','Bu kanal açıldı.')] });
      }
    }
  },

  // ──────────────────────────────────────────
  //  /ping
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder().setName('ping').setDescription('Bot gecikmesini gösterir'),
    cooldown: 5,
    async execute(i, client) {
      await i.reply({ embeds:[infoEmbed('🏓 Pong!',`**Bot Ping:** ${client.ws.ping}ms\n**API Gecikmesi:** ${Date.now()-i.createdTimestamp}ms`)] });
    }
  },

  // ──────────────────────────────────────────
  //  /yardim
  // ──────────────────────────────────────────
  {
    data: new SlashCommandBuilder().setName('yardim').setDescription('Tüm komutları listeler'),
    cooldown: 10,
    async execute(i) {
      const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('⚡ Prox Bot — Komutlar')
        .setThumbnail(i.client.user.displayAvatarURL())
        .addFields(
          { name:'⚔️ Moderasyon',    value:'`/ban` `/unban` `/kick` `/mute` `/unmute` `/uyar` `/cezalar` `/temizle`', inline:false },
          { name:'📋 Kayıt',         value:'`/kayit`', inline:false },
          { name:'⚙️ Kurulum',        value:'`/setup` `/sistem`', inline:false },
          { name:'📊 İstatistik',     value:'`/stats` `/coin` `/davet` `/sunucu` `/kullanici`', inline:false },
          { name:'🎫 Ticket',         value:'`/ticket-panel`', inline:false },
          { name:'🔊 Ses',            value:'`/ses`', inline:false },
          { name:'🎉 Çekiliş',        value:'`/cekilis`', inline:false },
          { name:'🚫 Blacklist',      value:'`/blacklist`', inline:false },
          { name:'📋 Yetkili',        value:'`/basvuru`', inline:false },
          { name:'🔧 Yardımcı',       value:'`/rol` `/yavaslat` `/kilit` `/ping` `/yardim`', inline:false },
        )
        .setFooter({ text:`Prox Bot • ${i.client.guilds.cache.size} sunucu` }).setTimestamp();
      await i.reply({ embeds:[embed], ephemeral:true });
    }
  },
];

// ─── Çekiliş bitirme ─────────────────────────
export async function endGiveaway(messageId, channel) {
  const g = _db.data.giveaways[messageId];
  if (!g || g.ended) return;
  g.ended = true;
  const winners = [...g.participants].sort(()=>0.5-Math.random()).slice(0,g.winnerCount);
  const embed = new EmbedBuilder().setColor(0x95a5a6).setTitle('🎉 Çekiliş Bitti!')
    .setDescription(`**Ödül:** ${g.prize}\n${winners.length?`**Kazanan(lar):** ${winners.map(id=>`<@${id}>`).join(', ')}`:'**Kazanan yok** (kimse katılmadı)'}`)
    .setTimestamp();
  await channel.messages.fetch(messageId).then(m=>m.edit({ embeds:[embed], components:[] })).catch(()=>{});
  if (winners.length) await channel.send({ content:`🎊 Tebrikler ${winners.map(id=>`<@${id}>`).join(', ')}! **${g.prize}** kazandınız!` });
  await _saveDB();
}
