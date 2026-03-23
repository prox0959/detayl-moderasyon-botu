// =============================================
//   PROX BOT - index.js  v3.0
//   Full sistem - tek dosya
// =============================================
import {
  Client, GatewayIntentBits, Partials, Collection,
  REST, Routes, ActivityType, ChannelType,
  PermissionFlagsBits, EmbedBuilder,
  ActionRowBuilder, ButtonBuilder, ButtonStyle,
  SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
  StringSelectMenuBuilder, StringSelectMenuOptionBuilder
} from 'discord.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import cron from 'node-cron';
import chalk from 'chalk';
import ms from 'ms';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH   = join(__dirname, 'database.json');
const CFG_PATH  = join(__dirname, 'id.json');

const cfg = JSON.parse(readFileSync(CFG_PATH, 'utf-8'));
Object.entries(cfg).forEach(([k,v]) => { process.env[k] = String(v); });

// =============================================
//   VERİTABANI
// =============================================
const defaultDB = {
  guilds:{}, users:{}, tickets:{}, blacklist:[],
  giveaways:{}, invites:{}, applications:{}, logs:[],
  blacklistGuilds:[], sesMutes:{}
};

function loadDB() {
  if (!existsSync(DB_PATH)) { writeFileSync(DB_PATH, JSON.stringify(defaultDB,null,2)); return {data:JSON.parse(JSON.stringify(defaultDB))}; }
  try { return {data:JSON.parse(readFileSync(DB_PATH,'utf-8'))}; }
  catch { return {data:JSON.parse(JSON.stringify(defaultDB))}; }
}
const db = loadDB();
function saveDB() { writeFileSync(DB_PATH, JSON.stringify(db.data,null,2)); }
// ─── Yardımcı: bildirim rolü al ─────────────
function getNotifRolId(guildData) {
  // Önce yetkiliRol, yoksa mod, yoksa admin
  return guildData.roles?.yetkiliRol || guildData.roles?.mod || guildData.roles?.admin || null;
}

function addLog(e) {
  db.data.logs.unshift({...e, ts:Date.now()});
  if (db.data.logs.length>500) db.data.logs=db.data.logs.slice(0,500);
  saveDB();
}

function getGuild(gid) {
  if (!db.data.guilds[gid]) {
    db.data.guilds[gid] = {
      id:gid,
      channels:{log:null,ticket:null,ticketCategory:null,kayit:null,yetkiliLog:null,basvuruKanal:null,sesLog:null,davetLog:null,setupBilgi:null},
      roles:{admin:null,mod:null,kayitli:null,erkek:null,kadin:null,unregistered:null,mute:null,sesRol:null},
      rolPerms:{},  // {rolId: {ban:true, kick:false, ...}}
      systems:{ticket:true,kayit:true,antiSpam:true,blacklist:true,davet:true,coin:true,ses:true,meeting:false,basvuru:false},
      ticket:{image:null,color:'#5865F2',description:null,sorumluRol:null},
      basvuruSorular:[],
      createdAt:Date.now(),
    };
    saveDB();
  }
  return db.data.guilds[gid];
}

function getUser(uid,gid) {
  const key=gid+'_'+uid;
  if (!db.data.users[key]) {
    db.data.users[key]={
      userId:uid, guildId:gid, coin:0, totalCoin:0,
      stats:{messages:0,voiceMinutes:0,commands:0,invites:0,dailyMessages:0,dailyVoice:0},
      punishments:[],
      staffStats:{kicks:0,bans:0,mutes:0,warns:0,kayits:0,tickets:0},
      daily:{lastClaim:0,streak:0},
      createdAt:Date.now(),
    };
    saveDB();
  }
  return db.data.users[key];
}

// =============================================
//   EMBED YARDIMCILARI
// =============================================
const E = {
  ok:  (t,d) => new EmbedBuilder().setColor(0x2ecc71).setTitle('✅ '+t).setDescription(d).setTimestamp(),
  err: (t,d) => new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ '+t).setDescription(d).setTimestamp(),
  warn:(t,d) => new EmbedBuilder().setColor(0xf39c12).setTitle('⚠️ '+t).setDescription(d).setTimestamp(),
  info:(t,d) => new EmbedBuilder().setColor(0x3498db).setTitle('ℹ️ '+t).setDescription(d).setTimestamp(),
};

function punishEmbed({type,target,mod,reason,duration}) {
  const icons={ban:'🔨',kick:'👢',mute:'🔇',warn:'⚠️',unban:'✅',unmute:'🔊'};
  const colors={ban:0xe74c3c,kick:0xe67e22,mute:0x3498db,warn:0xf39c12};
  const e=new EmbedBuilder().setColor(colors[type]||0x2c2f33)
    .setTitle((icons[type]||'🔧')+' '+type.toUpperCase())
    .addFields(
      {name:'Kullanıcı',value:'<@'+target.id+'> ('+target.tag+')',inline:true},
      {name:'Yetkili',value:'<@'+mod.id+'>',inline:true},
      {name:'Sebep',value:reason||'Belirtilmedi'},
    ).setThumbnail(target.displayAvatarURL()).setTimestamp();
  if (duration) e.addFields({name:'Süre',value:duration,inline:true});
  return e;
}

// Blacklist kontrol fonksiyonu — hem guildMemberAdd hem blacklistkontrol için
async function checkBlacklist(member, guildData, discordGuild) {
  if (!db.data.blacklistGuilds||db.data.blacklistGuilds.length===0) return false;

  // Yöntem 1: Botun bulunduğu sunucular içinde ara (hızlı)
  const inBotGuilds=client.guilds.cache.filter(g=>g.members.cache.has(member.id)&&g.id!==discordGuild.id);
  let hitEntry=null;
  let hitName=null;

  for (const [,g] of inBotGuilds) {
    const found=db.data.blacklistGuilds.find(bg=>bg.guildId===g.id);
    if (found) { hitEntry=found; hitName=g.name; break; }
  }

  // Yöntem 2: Mutual guilds API (botun olmadığı sunucular için — üyeyi fetch et)
  if (!hitEntry) {
    try {
      // Discord mutual guilds bilgisini doğrudan API'den alamayız,
      // ama üyenin presence/guild listesini kontrol edebiliriz.
      // En güvenilir yol: db'deki blacklist ID'lerini üyenin bilinen sunucularıyla karşılaştır.
      // Bu kısım botun bulunduğu sunucularla sınırlı — /blacklistkontrol ile manuel tarama yapılabilir.
    } catch {}
  }

  if (!hitEntry) return false;

  const displayName=hitName||hitEntry.name||hitEntry.guildId;

  // Log kanalına bildir
  const logCh=discordGuild.channels.cache.get(guildData.channels.log);
  if (logCh) {
    await logCh.send({embeds:[new EmbedBuilder().setColor(0xe74c3c)
      .setTitle('🚨 Blacklist Sunucu Tespiti')
      .setDescription('<@'+member.id+'> ('+member.user.tag+') blacklist sunucusunda aktif üye!')
      .addFields(
        {name:'🏠 Blacklist Sunucu',value:'**'+displayName+'** ('+hitEntry.guildId+')',inline:true},
        {name:'📋 Sebep',value:hitEntry.reason||'Belirtilmedi',inline:true},
        {name:'👤 Kullanıcı',value:'<@'+member.id+'> (`'+member.id+'`)',inline:true},
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp()]}).catch(()=>{});
  }

  // Kullanıcıya DM uyarısı
  await member.user.send({embeds:[new EmbedBuilder().setColor(0xf39c12)
    .setTitle('⚠️ Blacklist Sunucu Uyarısı')
    .setDescription(
      '**'+discordGuild.name+'** sunucusunda bulunduğun tespit edildi, ancak bir blacklist sunucusunda aktif üye olduğun görüldü.\n\n'+
      '**Blacklist Sunucu:** '+displayName+'\n'+
      '**Sebep:** '+(hitEntry.reason||'Belirtilmedi')+'\n\n'+
      'Lütfen bu sunucudan ayrılmayı değerlendir.'
    )
    .setFooter({text:'Bu uyarı '+discordGuild.name+' yönetimi tarafından gönderilmiştir.'})
    .setTimestamp()]}).catch(()=>{});

  return true;
}

async function sendLog(guild,dg,embed,key='log') {
  const chId=guild.channels?.[key]||guild.channels?.log;
  const ch=dg.channels.cache.get(chId);
  if (ch) await ch.send({embeds:[embed]}).catch(()=>{});
}

// =============================================
//   ÇEKİLİŞ BİTİRME
// =============================================
async function endGiveaway(msgId,channel) {
  const g=db.data.giveaways[msgId]; if (!g||g.ended) return;
  g.ended=true;
  const winners=[...g.participants].sort(()=>0.5-Math.random()).slice(0,g.winnerCount);
  const embed=new EmbedBuilder().setColor(0x95a5a6).setTitle('🎉 Çekiliş Bitti!')
    .setDescription('**Ödül:** '+g.prize+'\n'+(winners.length?'**Kazanan(lar):** '+winners.map(id=>'<@'+id+'>').join(', '):'**Kazanan yok**'))
    .setTimestamp();
  await channel.messages.fetch(msgId).then(m=>m.edit({embeds:[embed],components:[]})).catch(()=>{});
  if (winners.length) await channel.send({content:'🎊 Tebrikler '+winners.map(id=>'<@'+id+'>').join(', ')+'! **'+g.prize+'** kazandınız!'});
  saveDB();
}

// =============================================
//   ŞABLON KURULUM
// =============================================
const TEMPLATE_CODE='WE4FTKGqcecj';

// ── Discord izin sabitleri ──────────────────────────────────────
const P = PermissionFlagsBits;
const PERM_SETS = {
  ADMIN: [P.Administrator],
  MOD_FULL: [
    P.KickMembers, P.BanMembers, P.ManageMessages, P.ManageChannels,
    P.MuteMembers, P.DeafenMembers, P.MoveMembers, P.ManageNicknames,
    P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks,
    P.AttachFiles, P.UseExternalEmojis, P.AddReactions, P.Connect, P.Speak
  ],
  MOD: [
    P.KickMembers, P.ManageMessages, P.MuteMembers, P.MoveMembers,
    P.ManageNicknames, P.ViewChannel, P.SendMessages, P.ReadMessageHistory,
    P.EmbedLinks, P.AttachFiles, P.UseExternalEmojis, P.AddReactions,
    P.Connect, P.Speak
  ],
  TRIAL: [
    P.ManageMessages, P.MuteMembers,
    P.ViewChannel, P.SendMessages, P.ReadMessageHistory,
    P.EmbedLinks, P.AttachFiles, P.Connect, P.Speak
  ],
  MEMBER: [
    P.ViewChannel, P.SendMessages, P.ReadMessageHistory,
    P.EmbedLinks, P.AttachFiles, P.UseExternalEmojis,
    P.AddReactions, P.Connect, P.Speak, P.ChangeNickname
  ],
  NONE: [],
};
function buildPerms(set) {
  if (set === 'ADMIN') return new PermissionsBitField([P.Administrator]);
  const flags = PERM_SETS[set] || [];
  return flags.length ? new PermissionsBitField(flags) : new PermissionsBitField(0n);
}

// ── Prox Bot rol yapısı ─────────────────────────────────────────
const PROX_ROLES = [
  // YONETiM
  {name:'Kurucu',       emoji:'👑', color:0xFFD700, hoist:true,  key:'admin',        perm:'ADMIN',    mentionable:false},
  {name:'Yonetici',     emoji:'⚡', color:0xFF6B35, hoist:true,  key:'admin2',       perm:'ADMIN',    mentionable:true},
  {name:'Bas Yetkili',  emoji:'🛡', color:0xE74C3C, hoist:true,  key:'basYetkili',   perm:'MOD_FULL', mentionable:true},
  {name:'Moderator',    emoji:'⚔', color:0x9B59B6, hoist:true,  key:'mod',          perm:'MOD',      mentionable:true},
  {name:'Trial Mod',    emoji:'🔰', color:0x3498DB, hoist:true,  key:'trialMod',     perm:'TRIAL',    mentionable:true},
  {name:'Kidemli Uye',  emoji:'🎖', color:0x1ABC9C, hoist:true,  key:'kidamliUye',   perm:'NONE',     mentionable:false},
  // AYIRICI 1
  {name:'━━━━━━━━━━━━━━━━━━━━━━', emoji:'',  color:0x23272A, hoist:false, key:'sep1', perm:'NONE', mentionable:false},
  // OZEL
  {name:'VIP',          emoji:'🎁', color:0xF1C40F, hoist:true,  key:'vip',          perm:'NONE',     mentionable:false},
  {name:'Bot',          emoji:'🤖', color:0x57F287, hoist:true,  key:'botRol',       perm:'NONE',     mentionable:false},
  {name:'Event',        emoji:'🎉', color:0xEB459E, hoist:false, key:'eventRol',     perm:'NONE',     mentionable:true},
  {name:'Duyuru Ping',  emoji:'📢', color:0x5865F2, hoist:false, key:'duyuruPing',   perm:'NONE',     mentionable:true},
  {name:'Yetkili Bildirim', emoji:'🔔', color:0xFFA500, hoist:false, key:'yetkiliRol', perm:'NONE',   mentionable:true},
  // AYIRICI 2
  {name:'━━━━━━━━━━━━━━━━━━━━━━', emoji:'',  color:0x23272A, hoist:false, key:'sep2', perm:'NONE', mentionable:false},
  // KAYIT
  {name:'Erkek',        emoji:'👦', color:0x3498DB, hoist:false, key:'erkek',        perm:'NONE',     mentionable:false},
  {name:'Kiz',          emoji:'👧', color:0xFF69B4, hoist:false, key:'kadin',        perm:'NONE',     mentionable:false},
  {name:'Kayitli',      emoji:'✅', color:0x2ECC71, hoist:false, key:'kayitli',      perm:'MEMBER',   mentionable:false},
  // AYIRICI 3
  {name:'━━━━━━━━━━━━━━━━━━━━━━', emoji:'',  color:0x23272A, hoist:false, key:'sep3', perm:'NONE', mentionable:false},
  // SISTEM
  {name:'Mute',         emoji:'🔇', color:0x95A5A6, hoist:false, key:'mute',         perm:'NONE',     mentionable:false},
  {name:'Ses',          emoji:'🔊', color:0x1ABC9C, hoist:false, key:'sesRol',       perm:'NONE',     mentionable:false},
  {name:'Kayitsiz',     emoji:'❓', color:0x7F8C8D, hoist:false, key:'unregistered', perm:'NONE',     mentionable:false},
];

// ── Kanal izin şablonları ───────────────────────────────────────
// Her kanal/kategori için hangi roller ne yapabilir tanımlanıyor
// 'rk' = rol keylerinden oluşan izin listesi
// deny:  bu keyler için ViewChannel deny edilir
// allow: bu keyler için belirtilen izinler verilir
// Tanım: {roleKey, allow:[], deny:[]}

// Yardımcı: PermissionOverwrite listesi oluştur (roller oluşturulduktan sonra çağrılır)
function buildOverwrites(guild, gData, overwriteDefs) {
  const ow = [
    // @everyone: varsayılan olarak ViewChannel kapat
    {id: guild.id, deny: [P.ViewChannel, P.SendMessages, P.Connect]}
  ];
  for (const def of overwriteDefs) {
    const roleId = gData.roles[def.roleKey] ||
                   // bazı keyler skip listesinde — bunlar için rol cache'den bul
                   [...guild.roles.cache.values()].find(r =>
                     r.name.toLowerCase().includes(def.nameHint||'__NO__')
                   )?.id;
    if (!roleId) continue;
    const entry = {id: roleId};
    if (def.allow && def.allow.length) entry.allow = def.allow;
    if (def.deny  && def.deny.length)  entry.deny  = def.deny;
    ow.push(entry);
  }
  return ow;
}

// Ortak izin grupları
const OW = {
  VIEW_SEND:  [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.EmbedLinks, P.AttachFiles, P.AddReactions, P.UseExternalEmojis],
  VIEW_ONLY:  [P.ViewChannel, P.ReadMessageHistory],
  VOICE_USE:  [P.ViewChannel, P.Connect, P.Speak, P.Stream, P.UseVAD],
  VOICE_MOD:  [P.ViewChannel, P.Connect, P.Speak, P.MuteMembers, P.DeafenMembers, P.MoveMembers, P.PrioritySpeaker],
  MOD_TEXT:   [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.ManageMessages, P.EmbedLinks, P.AttachFiles],
};

// ── Prox Bot kanal yapısı ───────────────────────────────────────
// perms: overwrite tanım listesi — her item: {roleKey, allow?, deny?, nameHint?}
const PROX_CHANNELS = [

  // ════════════════════════════════════════
  //  📋 BİLGİ
  // ════════════════════════════════════════
  {cat:'📋 BILGI', type:'cat', perms:[
    // Kayıtlı + tüm yetkililer görebilir
    {roleKey:'kayitli',      allow:OW.VIEW_ONLY},
    {roleKey:'erkek',        allow:OW.VIEW_ONLY},
    {roleKey:'kadin',        allow:OW.VIEW_ONLY},
    {roleKey:'mod',          allow:OW.VIEW_SEND},
    {roleKey:'admin',        allow:OW.VIEW_SEND},
  ]},
  {name:'📢・duyurular',   type:'text', cat:'📋 BILGI', key:'duyuru', perms:[
    {roleKey:'kayitli',      allow:OW.VIEW_ONLY},    // sadece okuyabilir
    {roleKey:'erkek',        allow:OW.VIEW_ONLY},
    {roleKey:'kadin',        allow:OW.VIEW_ONLY},
    {roleKey:'mod',          allow:OW.VIEW_SEND},
    {roleKey:'admin',        allow:OW.VIEW_SEND},
  ]},
  {name:'📜・kurallar',    type:'text', cat:'📋 BILGI', perms:[
    {roleKey:'kayitli',      allow:OW.VIEW_ONLY},
    {roleKey:'erkek',        allow:OW.VIEW_ONLY},
    {roleKey:'kadin',        allow:OW.VIEW_ONLY},
    {roleKey:'mod',          allow:OW.VIEW_SEND},
    {roleKey:'admin',        allow:OW.VIEW_SEND},
  ]},
  {name:'🎉・etkinlikler', type:'text', cat:'📋 BILGI', perms:[
    {roleKey:'kayitli',      allow:OW.VIEW_ONLY},
    {roleKey:'erkek',        allow:OW.VIEW_ONLY},
    {roleKey:'kadin',        allow:OW.VIEW_ONLY},
    {roleKey:'mod',          allow:OW.VIEW_SEND},
    {roleKey:'admin',        allow:OW.VIEW_SEND},
  ]},

  // ════════════════════════════════════════
  //  💬 GENEL
  // ════════════════════════════════════════
  {cat:'💬 GENEL', type:'cat', perms:[
    {roleKey:'kayitli',      allow:OW.VIEW_SEND},
    {roleKey:'erkek',        allow:OW.VIEW_SEND},
    {roleKey:'kadin',        allow:OW.VIEW_SEND},
    {roleKey:'mod',          allow:OW.VIEW_SEND},
    {roleKey:'admin',        allow:OW.VIEW_SEND},
    {roleKey:'mute',         deny: OW.VIEW_SEND},   // mute: yazma/bağlanma yok
  ]},
  {name:'💬・genel',       type:'text', cat:'💬 GENEL', perms:[
    {roleKey:'kayitli',      allow:OW.VIEW_SEND},
    {roleKey:'erkek',        allow:OW.VIEW_SEND},
    {roleKey:'kadin',        allow:OW.VIEW_SEND},
    {roleKey:'mod',          allow:[...OW.VIEW_SEND, P.ManageMessages]},
    {roleKey:'admin',        allow:[...OW.VIEW_SEND, P.ManageMessages]},
    {roleKey:'mute',         deny: [P.SendMessages]},
  ]},
  {name:'🤣・medya',       type:'text', cat:'💬 GENEL', perms:[
    {roleKey:'kayitli',      allow:OW.VIEW_SEND},
    {roleKey:'erkek',        allow:OW.VIEW_SEND},
    {roleKey:'kadin',        allow:OW.VIEW_SEND},
    {roleKey:'mod',          allow:[...OW.VIEW_SEND, P.ManageMessages]},
    {roleKey:'admin',        allow:[...OW.VIEW_SEND, P.ManageMessages]},
    {roleKey:'mute',         deny: [P.SendMessages]},
  ]},
  {name:'🎮・oyunlar',     type:'text', cat:'💬 GENEL', perms:[
    {roleKey:'kayitli',      allow:OW.VIEW_SEND},
    {roleKey:'erkek',        allow:OW.VIEW_SEND},
    {roleKey:'kadin',        allow:OW.VIEW_SEND},
    {roleKey:'mod',          allow:[...OW.VIEW_SEND, P.ManageMessages]},
    {roleKey:'admin',        allow:[...OW.VIEW_SEND, P.ManageMessages]},
    {roleKey:'mute',         deny: [P.SendMessages]},
  ]},
  {name:'🎵 Genel',        type:'voice', cat:'💬 GENEL', perms:[
    {roleKey:'kayitli',      allow:OW.VOICE_USE},
    {roleKey:'erkek',        allow:OW.VOICE_USE},
    {roleKey:'kadin',        allow:OW.VOICE_USE},
    {roleKey:'mod',          allow:OW.VOICE_MOD},
    {roleKey:'admin',        allow:OW.VOICE_MOD},
    {roleKey:'mute',         deny: [P.Speak, P.Stream]},
  ]},
  {name:'🎮 Oyun',         type:'voice', cat:'💬 GENEL', perms:[
    {roleKey:'kayitli',      allow:OW.VOICE_USE},
    {roleKey:'erkek',        allow:OW.VOICE_USE},
    {roleKey:'kadin',        allow:OW.VOICE_USE},
    {roleKey:'mod',          allow:OW.VOICE_MOD},
    {roleKey:'admin',        allow:OW.VOICE_MOD},
    {roleKey:'mute',         deny: [P.Speak, P.Stream]},
  ]},

  // ════════════════════════════════════════
  //  📝 KAYIT
  // ════════════════════════════════════════
  {cat:'📝 KAYIT', type:'cat', perms:[
    // Kayıtsız kayıt kanalını görebilir
    {roleKey:'unregistered', allow:[P.ViewChannel, P.ReadMessageHistory]},
    {roleKey:'kayitli',      deny: [P.ViewChannel]}, // kayıtlılar göremez
    {roleKey:'erkek',        deny: [P.ViewChannel]},
    {roleKey:'kadin',        deny: [P.ViewChannel]},
    {roleKey:'mod',          allow:OW.MOD_TEXT},
    {roleKey:'admin',        allow:OW.MOD_TEXT},
  ]},
  {name:'📝・kayit',       type:'text', cat:'📝 KAYIT', key:'kayit', perms:[
    {roleKey:'unregistered', allow:[P.ViewChannel, P.SendMessages, P.ReadMessageHistory]},
    {roleKey:'kayitli',      deny: [P.ViewChannel]},
    {roleKey:'erkek',        deny: [P.ViewChannel]},
    {roleKey:'kadin',        deny: [P.ViewChannel]},
    {roleKey:'mod',          allow:OW.MOD_TEXT},
    {roleKey:'admin',        allow:OW.MOD_TEXT},
  ]},
  {name:'📊・kayit-log',   type:'text', cat:'📝 KAYIT', key:'log', perms:[
    {roleKey:'unregistered', deny: [P.ViewChannel]}, // gizli
    {roleKey:'mod',          allow:OW.VIEW_ONLY},
    {roleKey:'admin',        allow:OW.MOD_TEXT},
  ]},

  // ════════════════════════════════════════
  //  🎫 DESTEK
  // ════════════════════════════════════════
  {cat:'🎫 DESTEK', type:'cat', perms:[
    {roleKey:'kayitli',      allow:[P.ViewChannel, P.ReadMessageHistory]},
    {roleKey:'erkek',        allow:[P.ViewChannel, P.ReadMessageHistory]},
    {roleKey:'kadin',        allow:[P.ViewChannel, P.ReadMessageHistory]},
    {roleKey:'mod',          allow:OW.MOD_TEXT},
    {roleKey:'admin',        allow:OW.MOD_TEXT},
  ]},
  {name:'🎫・ticket-ac',   type:'text', cat:'🎫 DESTEK', key:'ticket', perms:[
    {roleKey:'kayitli',      allow:[P.ViewChannel, P.SendMessages, P.ReadMessageHistory]},
    {roleKey:'erkek',        allow:[P.ViewChannel, P.SendMessages, P.ReadMessageHistory]},
    {roleKey:'kadin',        allow:[P.ViewChannel, P.SendMessages, P.ReadMessageHistory]},
    {roleKey:'mod',          allow:OW.MOD_TEXT},
    {roleKey:'admin',        allow:OW.MOD_TEXT},
  ]},
  // Ticket kanalları burada oluşturulur (bot yönetir)
  {cat:'🎫・TICKET KATEGORISI', type:'cat', key:'ticketCategory', perms:[
    {roleKey:'mod',          allow:OW.MOD_TEXT},
    {roleKey:'admin',        allow:OW.MOD_TEXT},
  ]},

  // ════════════════════════════════════════
  //  ⚔ YETKİLİ (sadece yetkililer görebilir)
  // ════════════════════════════════════════
  {cat:'⚔ YETKILI', type:'cat', perms:[
    {roleKey:'mod',          allow:OW.VIEW_SEND},
    {roleKey:'admin',        allow:OW.VIEW_SEND},
    // Normal üyeler kesinlikle göremez
    {roleKey:'kayitli',      deny:[P.ViewChannel]},
    {roleKey:'erkek',        deny:[P.ViewChannel]},
    {roleKey:'kadin',        deny:[P.ViewChannel]},
    {roleKey:'unregistered', deny:[P.ViewChannel]},
  ]},
  {name:'⚔・yetkili-genel', type:'text', cat:'⚔ YETKILI', perms:[
    {roleKey:'mod',          allow:OW.VIEW_SEND},
    {roleKey:'admin',        allow:[...OW.VIEW_SEND, P.ManageMessages]},
    {roleKey:'kayitli',      deny:[P.ViewChannel]},
    {roleKey:'erkek',        deny:[P.ViewChannel]},
    {roleKey:'kadin',        deny:[P.ViewChannel]},
  ]},
  {name:'📋・mod-log',     type:'text', cat:'⚔ YETKILI', key:'yetkiliLog', perms:[
    {roleKey:'mod',          allow:OW.VIEW_ONLY},
    {roleKey:'admin',        allow:OW.MOD_TEXT},
    {roleKey:'kayitli',      deny:[P.ViewChannel]},
    {roleKey:'erkek',        deny:[P.ViewChannel]},
    {roleKey:'kadin',        deny:[P.ViewChannel]},
  ]},
  {name:'📝・basvuru-log', type:'text', cat:'⚔ YETKILI', key:'basvuruKanal', perms:[
    {roleKey:'mod',          allow:OW.VIEW_SEND},
    {roleKey:'admin',        allow:[...OW.VIEW_SEND, P.ManageMessages]},
    {roleKey:'kayitli',      deny:[P.ViewChannel]},
    {roleKey:'erkek',        deny:[P.ViewChannel]},
    {roleKey:'kadin',        deny:[P.ViewChannel]},
  ]},
  {name:'🔊・ses-log',     type:'text', cat:'⚔ YETKILI', key:'sesLog', perms:[
    {roleKey:'mod',          allow:OW.VIEW_ONLY},
    {roleKey:'admin',        allow:OW.MOD_TEXT},
    {roleKey:'kayitli',      deny:[P.ViewChannel]},
    {roleKey:'erkek',        deny:[P.ViewChannel]},
    {roleKey:'kadin',        deny:[P.ViewChannel]},
  ]},
  {name:'🔒 Yetkili',      type:'voice', cat:'⚔ YETKILI', perms:[
    {roleKey:'mod',          allow:OW.VOICE_MOD},
    {roleKey:'admin',        allow:OW.VOICE_MOD},
    {roleKey:'kayitli',      deny:[P.ViewChannel, P.Connect]},
    {roleKey:'erkek',        deny:[P.ViewChannel, P.Connect]},
    {roleKey:'kadin',        deny:[P.ViewChannel, P.Connect]},
  ]},

  // ════════════════════════════════════════
  //  🤖 BOT
  // ════════════════════════════════════════
  {cat:'🤖 BOT', type:'cat', perms:[
    {roleKey:'kayitli',      allow:[P.ViewChannel, P.SendMessages, P.ReadMessageHistory]},
    {roleKey:'erkek',        allow:[P.ViewChannel, P.SendMessages, P.ReadMessageHistory]},
    {roleKey:'kadin',        allow:[P.ViewChannel, P.SendMessages, P.ReadMessageHistory]},
    {roleKey:'mod',          allow:OW.VIEW_SEND},
    {roleKey:'admin',        allow:OW.VIEW_SEND},
  ]},
  {name:'🤖・bot-komut',  type:'text', cat:'🤖 BOT', perms:[
    {roleKey:'kayitli',      allow:[P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.UseApplicationCommands]},
    {roleKey:'erkek',        allow:[P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.UseApplicationCommands]},
    {roleKey:'kadin',        allow:[P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.UseApplicationCommands]},
    {roleKey:'mod',          allow:[...OW.VIEW_SEND, P.UseApplicationCommands, P.ManageMessages]},
    {roleKey:'admin',        allow:[...OW.VIEW_SEND, P.UseApplicationCommands, P.ManageMessages]},
    {roleKey:'mute',         deny: [P.SendMessages]},
  ]},
];

async function installTemplate(guild) {
  try {
    const gData = getGuild(guild.id);

    // 1) Mevcut kanalları sil
    for (const [,ch] of guild.channels.cache) await ch.delete().catch(()=>{});

    // 2) Mevcut rolleri sil
    for (const [,r] of guild.roles.cache) {
      if (r.managed || r.id === guild.id) continue;
      await r.delete().catch(()=>{});
    }

    // 3) Rolleri oluştur (yukarıdan aşağıya = yüksek pozisyondan düşüğe)
    for (const rd of PROX_ROLES) {
      const fullName = rd.emoji ? rd.emoji + ' ' + rd.name : rd.name;
      const created = await guild.roles.create({
        name:        fullName,
        color:       rd.color,
        hoist:       rd.hoist,
        mentionable: rd.mentionable,
        permissions: buildPerms(rd.perm),
      }).catch(e => { console.error('[Rol Hata]', rd.name, e.message); return null; });

      if (!created) continue;

      // DB'ye kaydet (separator ve bazı keyler hariç)
      const skip = ['sep1','sep2','sep3','botRol','vip','eventRol','duyuruPing','kidamliUye','admin2','basYetkili','trialMod'];
      if (!skip.includes(rd.key)) {
        gData.roles[rd.key] = created.id;
      }
      // Yetkili bildirim rolünü de kaydet
      if (rd.key === 'yetkiliRol') gData.roles.yetkiliRol = created.id;
      // mod için de yetkiliRol olarak kullan (yoksa)
      if (rd.key === 'mod' && !gData.roles.yetkiliRol) gData.roles.yetkiliRol = created.id;
    }

    // 4) Kanalları oluştur (izinlerle birlikte)
    const catMap = new Map(); // cat name → channel id
    for (const cd of PROX_CHANNELS) {
      const ow = cd.perms ? buildOverwrites(guild, gData, cd.perms) : [
        {id: guild.id, deny: [P.ViewChannel]}
      ];

      if (cd.type === 'cat') {
        const created = await guild.channels.create({
          name: cd.cat,
          type: ChannelType.GuildCategory,
          permissionOverwrites: ow,
        }).catch(e=>{console.error('[Kanal Hata]',cd.cat,e.message);return null;});
        if (created) {
          catMap.set(cd.cat, created.id);
          if (cd.key) gData.channels[cd.key] = created.id;
        }
      } else {
        const parentId = cd.cat ? catMap.get(cd.cat) || null : null;
        const chType = cd.type === 'voice' ? ChannelType.GuildVoice : ChannelType.GuildText;
        const created = await guild.channels.create({
          name: cd.name,
          type: chType,
          parent: parentId,
          permissionOverwrites: ow,
        }).catch(e=>{console.error('[Kanal Hata]',cd.name,e.message);return null;});
        if (created && cd.key) gData.channels[cd.key] = created.id;
      }
    }

    // 5) Sistemleri aç
    gData.systems.ticket   = true;
    gData.systems.kayit    = true;
    gData.systems.antiSpam = true;
    gData.systems.blacklist= true;
    gData.systems.davet    = true;
    gData.systems.coin     = true;
    gData.systems.ses      = true;

    saveDB();
    console.log(chalk.green('[Sablon] Kurulum tamamlandi: '+guild.name));
    return true;
  } catch(e) {
    console.error(chalk.red('[Sablon Hata]'), e.message);
    return false;
  }
}

// =============================================
//   TICKET PANELİ GÖNDER (yardımcı)
// =============================================
async function sendTicketPanel(channel,gData,guild) {
  const tCfg=gData.ticket||{};
  const sorumluRol=tCfg.sorumluRol||gData.roles.mod;
  const color=parseInt((tCfg.color||'#5865F2').replace('#',''),16)||0x5865F2;
  const desc=tCfg.description||'Destek almak için aşağıdaki menüyü kullanın.\nÖnce kategori seçecek, sonra açıklama gireceksiniz.';

  const embed=new EmbedBuilder()
    .setColor(color)
    .setTitle('🎫 Destek Paneli')
    .setDescription(
      desc+'\n\n'+
      '**Sorumlu Rol:** '+(sorumluRol?'<@&'+sorumluRol+'>':'Belirlenmedi')
    )
    .setFooter({text:(guild?.name||'Prox Bot')+' • Ticket Sistemi'})
    .setTimestamp();
  if (tCfg.image) embed.setImage(tCfg.image);

  const menu=new StringSelectMenuBuilder()
    .setCustomId('ticket_kategori')
    .setPlaceholder('📋 Ticket kategorisini seçiniz...')
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('📋 Genel Destek').setValue('genel').setDescription('Genel yardım ve sorular').setEmoji('📋'),
      new StringSelectMenuOptionBuilder().setLabel('🔨 Ban / Ceza İtirazı').setValue('ban_itiraz').setDescription('Ceza veya ban itirazı').setEmoji('🔨'),
      new StringSelectMenuOptionBuilder().setLabel('💰 Satın Alım').setValue('satin_alim').setDescription('VIP, özel paket vb.').setEmoji('💰'),
      new StringSelectMenuOptionBuilder().setLabel('🛡️ Şikayet').setValue('sikayet').setDescription('Yetkili veya üye şikayeti').setEmoji('🛡️'),
      new StringSelectMenuOptionBuilder().setLabel('📝 Diğer').setValue('diger').setDescription('Diğer konular').setEmoji('📝'),
    );
  const row=new ActionRowBuilder().addComponents(menu);
  await channel.send({embeds:[embed],components:[row]});
}

// =============================================
//   TİCKET KANAL OLUŞTURUCU
// =============================================
async function createTicketChannel(interaction, guild, kategori) {
  // Universal reply helper
  async function respond(content) {
    const opts = {content, ephemeral:true};
    try {
      if (interaction.deferred || interaction.replied) return await interaction.followUp(opts);
      return await interaction.reply(opts);
    } catch {
      try { return await interaction.followUp(opts); } catch {}
    }
  }

  // Bot Yönetici kontrolü
  const botMember = interaction.guild.members.me;
  if (!botMember) return respond('❌ Bot sunucuda bulunamıyor.');

  const hasAdmin = botMember.permissions.has(PermissionFlagsBits.Administrator);
  const hasManage = botMember.permissions.has(PermissionFlagsBits.ManageChannels);
  if (!hasAdmin && !hasManage) {
    return respond('❌ Bot yetki hatası: **Kanalları Yönet** veya **Yönetici** yetkisi gerekli.');
  }

  // Açık ticket var mı?
  const existing = interaction.guild.channels.cache.find(
    ch => ch.name === 'ticket-' + interaction.user.id && !ch.deleted
  );
  if (existing) return respond('❌ Zaten açık bir ticketin var: ' + existing);

  // Kategori — yoksa kategorisiz aç
  let parent = null;
  const catId = guild.channels.ticketCategory || guild.channels.ticket || null;
  if (catId) {
    const cat = interaction.guild.channels.cache.get(catId);
    if (cat && cat.type === 4) parent = catId; // 4 = GuildCategory
  }

  // Permission overwrites — sadece sunucudaki geçerli rolleri ekle
  const perms = [
    {
      id: interaction.guild.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.ReadMessageHistory
      ]
    },
    {
      id: interaction.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels
      ]
    }
  ];

  // Mod/admin rollerini cache'den doğrula — geçersizse ekleme
  const addRolePerm = (roleId) => {
    if (!roleId) return;
    if (!interaction.guild.roles.cache.has(roleId)) return;
    // Zaten eklenmiş mi?
    if (perms.find(p => p.id === roleId)) return;
    perms.push({
      id: roleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageMessages
      ]
    });
  };
  addRolePerm(guild.roles.yetkiliRol);
  addRolePerm(guild.roles.mod);
  addRolePerm(guild.roles.admin);

  // Kanalı oluştur
  let ch = null;
  try {
    ch = await interaction.guild.channels.create({
      name: 'ticket-' + interaction.user.id,
      type: ChannelType.GuildText,
      parent: parent,
      permissionOverwrites: perms
    });
  } catch (e) {
    console.error('[Ticket Kanal Hata]', e.message);
    // parent başarısız oldu — kategorisiz tekrar dene
    if (parent) {
      try {
        ch = await interaction.guild.channels.create({
          name: 'ticket-' + interaction.user.id,
          type: ChannelType.GuildText,
          permissionOverwrites: perms
        });
      } catch (e2) {
        console.error('[Ticket Kanal Hata2]', e2.message);
      }
    }
  }

  if (!ch) {
    return respond('❌ Kanal oluşturulamadı. Hata konsolda görünür. Bot rolüne **Yönetici** veya **Kanalları Yönet** yetkisi ver.');
  }

  // İçeriği gönder
  const tCfg = guild.ticket || {};
  const sorumluRol = tCfg.sorumluRol || guild.roles.yetkiliRol || guild.roles.mod || null;
  const color = parseInt((tCfg.color || '#5865F2').replace('#', ''), 16) || 0x5865F2;
  const desc  = tCfg.description || 'Destek ekibimiz en kısa sürede seninle ilgilenecek.\nLütfen sorununuzu detaylıca açıklayın.';

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('🎫 ' + kategori)
    .setDescription('Merhaba ' + interaction.user + '!\n\n' + desc)
    .addFields(
      {name: '📋 Kategori', value: kategori, inline: true},
      {name: '📅 Açılış',   value: '<t:' + Math.floor(Date.now()/1000) + ':R>', inline: true},
      {name: '👤 Kullanıcı',value: interaction.user.tag, inline: true}
    )
    .setFooter({text: 'Prox Bot • Ticket Sistemi'})
    .setTimestamp();
  if (tCfg.image) embed.setImage(tCfg.image);

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Ticketi Kapat')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒')
  );

  await ch.send({
    content: interaction.user.toString() + (sorumluRol ? ' <@&' + sorumluRol + '>' : ''),
    embeds:  [embed],
    components: [closeRow]
  }).catch(e => console.error('[Ticket Mesaj Hata]', e.message));

  // DB
  if (!db.data.tickets) db.data.tickets = {};
  db.data.tickets[ch.id] = {
    channelId:  ch.id,
    userId:     interaction.user.id,
    guildId:    interaction.guildId,
    kategori,
    openedAt:   Date.now(),
    closed:     false
  };
  try { getUser(interaction.user.id, interaction.guildId).staffStats.tickets++; } catch {}
  saveDB();
  addLog({type: 'ticket_open', guildId: interaction.guildId, targetId: interaction.user.id, kategori});

  // Log kanalı
  const logCh = interaction.guild.channels.cache.get(guild.channels.log);
  if (logCh) {
    logCh.send({embeds:[new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle('🎫 Yeni Ticket')
      .addFields(
        {name: 'Kullanıcı', value: interaction.user.tag + '\n<@' + interaction.user.id + '>', inline: true},
        {name: 'Kategori',  value: kategori, inline: true},
        {name: 'Kanal',     value: '<#' + ch.id + '>', inline: true}
      )
      .setTimestamp()
    ]}).catch(() => {});
  }

  return respond('✅ Ticketin oluşturuldu: ' + ch.toString());
}

// =============================================
//   QUICK SETUP (bot sunucuya eklenince)
// =============================================
async function quickSetup(guild) {
  try {
    const owner=await guild.fetchOwner().catch(()=>null);
    if (!owner) return;

    // Sadece sahibine DM at, kanal açma
    // Panel key oluştur (sunucuya özel)
    let panelKey=null, panelUrl=null;
    try {
      const {createKey}=await import('./server.js');
      const PORT=Number(process.env.WEB_PORT)||15545;
      const keyEntry=createKey(guild.name+' ('+owner.user.tag+')', guild.id, owner.id);
      panelKey=keyEntry.key;
      panelUrl='http://85.215.131.70:'+PORT+'/panel/'+panelKey;
    } catch(e){ console.error('Key oluşturulamadı:',e.message); }

    const setupEmbed=new EmbedBuilder().setColor(0x5865F2)
      .setTitle('👋 Prox Bot - Hızlı Kurulum')
      .setDescription('**'+guild.name+'** sunucusuna eklendiğin için teşekkürler!\n\nAşağıdaki komutlarla hızlıca kurulumu tamamla:')
      .addFields(
        {name:'1️⃣ Temel Kanallar',value:'`/setup log #kanal` — Log kanalı\n`/setup ticket #kanal` — Ticket kanalı\n`/setup ticket-kategori #kategori` — Ticket kategorisi\n`/setup basvuru-kanal #kanal` — Başvuru log kanalı'},
        {name:'2️⃣ Kayıt Sistemi',value:'`/setup kayit #kanal`\n`/setup kayitsiz-rol @rol`\n`/setup kayitli-rol @rol`\n`/setup erkek-rol @rol` / `kadin-rol @rol`'},
        {name:'3️⃣ Moderasyon',value:'`/setup mute-rol @rol`\n`/setup mod-rol @rol`'},
        {name:'4️⃣ Ticket Panel',value:'`/ticketsetup sorumlu-rol @rol`\n`/ticketsetup aciklama metin`\n`/ticketsetup gonder` -> Paneli istediğin kanala gönder'},
        {name:'5️⃣ Yetkili Başvuru',value:'`/yetkilibasvuru ac`\n`/yetkilibasvuru soru-ekle soru`'},
        {name:'6️⃣ Blacklist',value:'`/blacklist ekle-sunucu id isim sebep`'},
        {name:'🌐 Web Yönetim Paneli',value:panelUrl?'**Panelin:** `'+panelKey+'`\n[Panele Git]('+panelUrl+')\n\nBan, kick, mute, warn işlemlerini web üzerinden yapabilirsin.\n⚠️ Bu keyi kimseyle paylaşma!':'Oluşturulamadı'},
        {name:'🏗️ Şablon (Opsiyonel)',value:'Prox şablonunu kurmak istersen aşağıdaki butonu kullan.\n⚠️ Tüm kanallar ve roller silinir!'},
      )
      .setFooter({text:'Prox Bot • Panel Key: '+(panelKey||'—')})
      .setTimestamp();

    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sablon_dm_evet_'+guild.id).setLabel('✅ Şablonu Kur').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('sablon_dm_hayir_'+guild.id).setLabel('❌ Şablon Olmadan Devam').setStyle(ButtonStyle.Secondary),
    );

    await owner.send({embeds:[setupEmbed],components:[row]}).catch(async()=>{
      // DM kapalıysa sunucunun ilk kanalına gönder
      const ch=guild.channels.cache
        .filter(c=>c.type===0&&c.permissionsFor(guild.members.me)?.has('SendMessages'))
        .sort((a,b)=>a.rawPosition-b.rawPosition).first();
      if (ch) await ch.send({content:'<@'+owner.id+'>',embeds:[setupEmbed],components:[row]}).catch(()=>{});
    });

    getGuild(guild.id); // DB kaydı oluştur
  } catch(e) { console.error(chalk.red('[QuickSetup Hata]'),e.message); }
}

// =============================================
//   SLASH KOMUTLAR
// =============================================

// ══════════════════════════════════════════════
//   ROL YETKİ SİSTEMİ — hasBotPerm + PERMS_DEF
// ══════════════════════════════════════════════

const PERMS_DEF = {
  ban:          {label:'Ban At',          desc:'Uyeleri sunucudan kalici yasaklar',  cat:'Moderasyon'},
  kick:         {label:'Kick At',         desc:'Uyeleri sunucudan atar',             cat:'Moderasyon'},
  mute:         {label:'Timeout/Mute',    desc:'Uyeleri zaman asimina alir',         cat:'Moderasyon'},
  warn:         {label:'Uyari Ver',       desc:'Uyelere uyari verir',                cat:'Moderasyon'},
  unban:        {label:'Unban',           desc:'Banli uyeleri cozer',                cat:'Moderasyon'},
  temizle:      {label:'Mesaj Temizle',   desc:'Toplu mesaj silebilir',              cat:'Moderasyon'},
  kilit:        {label:'Kanal Kilitle',   desc:'Kanallari kilitler/acar',            cat:'Moderasyon'},
  yavaslat:     {label:'Yavas Mod',       desc:'Kanallara yavas mod uygular',        cat:'Moderasyon'},
  sesmute:      {label:'Ses Mute',        desc:'Ses kanalinda susturur',             cat:'Moderasyon'},
  kayit:        {label:'Kayit Yap',       desc:'Uye kaydi yapabilir',                cat:'Yonetim'},
  rol:          {label:'Rol Ver/Al',      desc:'Uyelere rol verebilir/alabilir',     cat:'Yonetim'},
  ticket_yonet: {label:'Ticket Yonet',    desc:'Ticketlari kapatip yanitlayabilir',  cat:'Yonetim'},
  toplanti:     {label:'Toplanti',        desc:'Toplanti baslatiip bitirebilir',     cat:'Yonetim'},
  duyuru:       {label:'Duyuru At',       desc:'Yetkililere DM duyurusu',            cat:'Yonetim'},
  cekilis:      {label:'Cekilis',         desc:'Cekilis baslatiip bitirebilir',      cat:'Eglence'},
  coin_ver:     {label:'Coin Ver',        desc:'Uyelere coin verebilir',             cat:'Eglence'},
  stats_goster: {label:'Istatistik',      desc:'Uye istatistiklerini gorebilir',     cat:'Bilgi'},
  setup:        {label:'Setup',           desc:'Bot ayarlarini degistirebilir',      cat:'Admin'},
  blacklist:    {label:'Blacklist',       desc:'Blacklist ekleyip cikarabilir',      cat:'Admin'},
  sistem:       {label:'Sistem Ac/Kapat', desc:'Sistemleri acip kapatabilir',        cat:'Admin'},
};

/**
 * Kullanicinin belirli bir bot iznine sahip olup olmadigini kontrol eder.
 * - Discord Administrator permisyonu: her zaman true
 * - Admin rolü: her zaman true
 * - rolPerms tablosunda o role o izin true ise: true
 */
function hasBotPerm(member, guildData, permKey) {
  if (!member || !guildData) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (guildData.roles?.admin && member.roles.cache.has(guildData.roles.admin)) return true;
  const rp = guildData.rolPerms || {};
  for (const [roleId] of member.roles.cache) {
    if (rp[roleId]?.[permKey] === true) return true;
  }
  return false;
}

function bjDesc(st, b) {
  if (st==='playing') return '**Bahis:** '+b+' coin — Cek (Hit) veya Dur (Stand)';
  if (st==='win')     return '**Kazandin!** +'+Math.floor(b*1.5)+' coin kazandin';
  if (st==='bj')      return '**BLACKJACK!** +'+Math.floor(b*1.5)+' coin';
  if (st==='bust')    return '**Batti!** Eli 21i gecti! -'+b+' coin';
  if (st==='lose')    return '**Kaybettin!** -'+b+' coin';
  if (st==='push')    return '**Berabere!** Bahis iade edildi';
  return '';
}

const commands=[

// ─── /ban ──────────────────────────────────
{ data:new SlashCommandBuilder().setName('ban').setDescription('Kullanıcıyı yasaklar').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addStringOption(o=>o.setName('sebep').setDescription('Sebep'))
    .addIntegerOption(o=>o.setName('mesaj_sil').setDescription('Mesaj sil gün (0-7)').setMinValue(0).setMaxValue(7)),
  cooldown:5,
  async execute(i) {
    const target=i.options.getMember('kullanici'); const reason=i.options.getString('sebep')||'Belirtilmedi'; const days=i.options.getInteger('mesaj_sil')??1;
    if (!target?.bannable) return i.reply({embeds:[E.err('Hata','Bu kullanıcıyı banlayamam.')],ephemeral:true});
    if (target.id===i.user.id) return i.reply({embeds:[E.err('Hata','Kendini banlayamazsın.')],ephemeral:true});
    await target.user.send({embeds:[new EmbedBuilder().setColor(0xe74c3c).setTitle('🔨 Sunucudan Yasaklandınız')
      .setDescription('**'+i.guild.name+'** sunucusundan yasaklandınız.')
      .addFields({name:'📋 Sebep',value:reason},{name:'👮 Yetkili',value:i.user.tag},{name:'📅 Tarih',value:'<t:'+Math.floor(Date.now()/1000)+':F>'})
      .setThumbnail(i.guild.iconURL()).setTimestamp()]}).catch(()=>{});
    await target.ban({reason,deleteMessageSeconds:days*86400});
    const ud=getUser(target.id,i.guildId); ud.punishments.push({type:'ban',reason,mod:i.user.id,timestamp:Date.now()});
    getUser(i.user.id,i.guildId).staffStats.bans++; saveDB();
    const embed=punishEmbed({type:'ban',target:target.user,mod:i.user,reason});
    await i.reply({embeds:[embed]}); await sendLog(getGuild(i.guildId),i.guild,embed);
    addLog({type:'ban',guildId:i.guildId,targetId:target.id,modId:i.user.id,reason});
  }
},

// ─── /unban ────────────────────────────────
{ data:new SlashCommandBuilder().setName('unban').setDescription('Yasağı kaldırır').setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addStringOption(o=>o.setName('kullanici_id').setDescription('Kullanıcı ID').setRequired(true))
    .addStringOption(o=>o.setName('sebep').setDescription('Sebep')),
  cooldown:5,
  async execute(i) {
    const uid=i.options.getString('kullanici_id'); const reason=i.options.getString('sebep')||'Belirtilmedi';
    await i.guild.members.unban(uid,reason).catch(()=>{});
    await i.reply({embeds:[E.ok('Unban','<@'+uid+'> yasağı kaldırıldı.\n**Sebep:** '+reason)]});
    addLog({type:'unban',guildId:i.guildId,targetId:uid,modId:i.user.id,reason});
  }
},

// ─── /kick ─────────────────────────────────
{ data:new SlashCommandBuilder().setName('kick').setDescription('Kullanıcıyı atar').setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addStringOption(o=>o.setName('sebep').setDescription('Sebep')),
  cooldown:5,
  async execute(i) {
    const target=i.options.getMember('kullanici'); const reason=i.options.getString('sebep')||'Belirtilmedi';
    if (!target?.kickable) return i.reply({embeds:[E.err('Hata','Bu kullanıcıyı atamam.')],ephemeral:true});
    await target.user.send({embeds:[new EmbedBuilder().setColor(0xe67e22).setTitle('👢 Sunucudan Atıldınız')
      .setDescription('**'+i.guild.name+'** sunucusundan atıldınız.')
      .addFields({name:'📋 Sebep',value:reason},{name:'👮 Yetkili',value:i.user.tag})
      .setThumbnail(i.guild.iconURL()).setTimestamp()]}).catch(()=>{});
    await target.kick(reason);
    const ud=getUser(target.id,i.guildId); ud.punishments.push({type:'kick',reason,mod:i.user.id,timestamp:Date.now()});
    getUser(i.user.id,i.guildId).staffStats.kicks++; saveDB();
    const embed=punishEmbed({type:'kick',target:target.user,mod:i.user,reason});
    await i.reply({embeds:[embed]}); await sendLog(getGuild(i.guildId),i.guild,embed);
    addLog({type:'kick',guildId:i.guildId,targetId:target.id,modId:i.user.id,reason});
  }
},

// ─── /mute ─────────────────────────────────
{ data:new SlashCommandBuilder().setName('mute').setDescription('Timeout uygular').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addStringOption(o=>o.setName('sure').setDescription('Süre: 10m 1h 1d').setRequired(true))
    .addStringOption(o=>o.setName('sebep').setDescription('Sebep')),
  cooldown:3,
  async execute(i) {
    const target=i.options.getMember('kullanici'); const sureStr=i.options.getString('sure'); const reason=i.options.getString('sebep')||'Belirtilmedi';
    const msVal=ms(sureStr);
    if (!msVal) return i.reply({embeds:[E.err('Hata','Geçersiz süre. Örn: `10m` `1h` `1d`')],ephemeral:true});
    if (!target) return i.reply({embeds:[E.err('Hata','Kullanıcı bulunamadı.')],ephemeral:true});
    await target.user.send({embeds:[new EmbedBuilder().setColor(0x3498db).setTitle('🔇 Susturuldunuz')
      .setDescription('**'+i.guild.name+'** sunucusunda susturuldunuz.')
      .addFields({name:'📋 Sebep',value:reason},{name:'⏱ Süre',value:sureStr},{name:'👮 Yetkili',value:i.user.tag})
      .setTimestamp()]}).catch(()=>{});
    await target.timeout(msVal,reason);
    const ud=getUser(target.id,i.guildId); ud.punishments.push({type:'mute',reason,duration:sureStr,mod:i.user.id,timestamp:Date.now()});
    getUser(i.user.id,i.guildId).staffStats.mutes++; saveDB();
    const embed=punishEmbed({type:'mute',target:target.user,mod:i.user,reason,duration:sureStr});
    await i.reply({embeds:[embed]}); await sendLog(getGuild(i.guildId),i.guild,embed);
    addLog({type:'mute',guildId:i.guildId,targetId:target.id,modId:i.user.id,reason,duration:sureStr});
  }
},

// ─── /unmute ───────────────────────────────
{ data:new SlashCommandBuilder().setName('unmute').setDescription("Timeout'u kaldırır").setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addStringOption(o=>o.setName('sebep').setDescription('Sebep')),
  cooldown:3,
  async execute(i) {
    const target=i.options.getMember('kullanici'); const reason=i.options.getString('sebep')||'Belirtilmedi';
    if (!target) return i.reply({embeds:[E.err('Hata','Kullanıcı bulunamadı.')],ephemeral:true});
    await target.timeout(null,reason);
    await i.reply({embeds:[E.ok('Unmute',target.user.tag+' susturması kaldırıldı.')]});
    addLog({type:'unmute',guildId:i.guildId,targetId:target.id,modId:i.user.id,reason});
  }
},

// ─── /uyar ─────────────────────────────────
{ data:new SlashCommandBuilder().setName('uyar').setDescription('Kullanıcıyı uyarır').setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
    .addStringOption(o=>o.setName('sebep').setDescription('Sebep').setRequired(true)),
  cooldown:3,
  async execute(i) {
    const target=i.options.getMember('kullanici'); const reason=i.options.getString('sebep');
    if (!target) return i.reply({embeds:[E.err('Hata','Kullanıcı bulunamadı.')],ephemeral:true});
    const ud=getUser(target.id,i.guildId); ud.punishments.push({type:'warn',reason,mod:i.user.id,timestamp:Date.now()});
    getUser(i.user.id,i.guildId).staffStats.warns++; saveDB();
    const cnt=ud.punishments.filter(p=>p.type==='warn').length;
    const embed=punishEmbed({type:'warn',target:target.user,mod:i.user,reason});
    embed.addFields({name:'Toplam Uyarı',value:'`'+cnt+'`',inline:true});
    await target.user.send({embeds:[embed]}).catch(()=>{});
    await i.reply({embeds:[embed]}); await sendLog(getGuild(i.guildId),i.guild,embed);
    addLog({type:'warn',guildId:i.guildId,targetId:target.id,modId:i.user.id,reason});
  }
},

// ─── /cezalar ──────────────────────────────
{ data:new SlashCommandBuilder().setName('cezalar').setDescription('Ceza geçmişi')
    .addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)),
  cooldown:5,
  async execute(i) {
    const target=i.options.getUser('kullanici'); const ud=getUser(target.id,i.guildId);
    if (!ud.punishments.length) return i.reply({embeds:[E.info('Ceza Geçmişi',target.tag+' için kayıt yok.')]});
    const embed=new EmbedBuilder().setColor(0xe74c3c).setTitle('📋 '+target.tag+' — Ceza Geçmişi').setThumbnail(target.displayAvatarURL())
      .setDescription(ud.punishments.slice(-10).reverse().map((p,idx)=>'**'+(idx+1)+'.** `'+p.type.toUpperCase()+'` — '+p.reason+'\n└ <@'+p.mod+'> • <t:'+Math.floor(p.timestamp/1000)+':R>').join('\n\n'))
      .setFooter({text:'Toplam '+ud.punishments.length+' ceza'}).setTimestamp();
    await i.reply({embeds:[embed]});
  }
},

// ─── /temizle ──────────────────────────────
{ data:new SlashCommandBuilder().setName('temizle').setDescription('Mesaj siler').setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o=>o.setName('miktar').setDescription('1-100').setRequired(true).setMinValue(1).setMaxValue(100))
    .addUserOption(o=>o.setName('kullanici').setDescription('Sadece bu kullanıcı')),
  cooldown:5,
  async execute(i) {
    const miktar=i.options.getInteger('miktar'); const target=i.options.getUser('kullanici');
    await i.deferReply({ephemeral:true});
    const msgs=await i.channel.messages.fetch({limit:100});
    let filtered=[...msgs.values()].slice(0,miktar);
    if (target) filtered=filtered.filter(m=>m.author.id===target.id);
    const deleted=await i.channel.bulkDelete(filtered,true).catch(()=>null);
    await i.editReply({embeds:[E.ok('Temizlendi','**'+(deleted?.size||0)+'** mesaj silindi.')]});
  }
},

// ─── /kayit ────────────────────────────────
{ data:new SlashCommandBuilder().setName('kayit').setDescription('Üyeyi kayıt eder').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(o=>o.setName('uye').setDescription('Üye').setRequired(true))
    .addStringOption(o=>o.setName('isim').setDescription('İsim').setRequired(true))
    .addIntegerOption(o=>o.setName('yas').setDescription('Yaş').setRequired(true).setMinValue(13).setMaxValue(99))
    .addStringOption(o=>o.setName('cinsiyet').setDescription('Cinsiyet').setRequired(true).addChoices({name:'👦 Erkek',value:'erkek'},{name:'👧 Kız',value:'kadin'})),
  cooldown:3,
  async execute(i) {
    const target=i.options.getMember('uye'); const isim=i.options.getString('isim');
    const yas=i.options.getInteger('yas'); const cinsiyet=i.options.getString('cinsiyet');
    const guild=getGuild(i.guildId);
    if (!guild.systems.kayit) return i.reply({embeds:[E.err('Kapalı','Kayıt sistemi aktif değil.')],ephemeral:true});
    if (!target) return i.reply({embeds:[E.err('Hata','Üye bulunamadı.')],ephemeral:true});
    await target.setNickname(isim+' | '+yas).catch(()=>{});
    const rolId=cinsiyet==='erkek'?guild.roles.erkek:guild.roles.kadin;
    if (rolId) await target.roles.add(rolId).catch(()=>{});
    if (guild.roles.kayitli) await target.roles.add(guild.roles.kayitli).catch(()=>{});
    if (guild.roles.unregistered) await target.roles.remove(guild.roles.unregistered).catch(()=>{});
    getUser(i.user.id,i.guildId).staffStats.kayits++; saveDB();
    const embed=E.ok('Kayıt Tamamlandı','**Üye:** '+target+'\n**İsim:** '+isim+' | '+yas+'\n**Cinsiyet:** '+(cinsiyet==='erkek'?'👦 Erkek':'👧 Kız')+'\n**Yetkili:** '+i.user);
    await i.reply({embeds:[embed]});
    const logCh=guild.channels.kayit||guild.channels.log;
    if (logCh){const ch=i.guild.channels.cache.get(logCh);if(ch)await ch.send({embeds:[embed]});}
    addLog({type:'kayit',guildId:i.guildId,targetId:target.id,modId:i.user.id});
  }
},

// ─── /setup ────────────────────────────────
{ data:new SlashCommandBuilder().setName('setup').setDescription('Bot kurulum ayarları').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s=>s.setName('log').setDescription('Log kanalı').addChannelOption(o=>o.setName('kanal').setDescription('Kanal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s=>s.setName('ticket').setDescription('Ticket kanalı').addChannelOption(o=>o.setName('kanal').setDescription('Kanal').setRequired(true)))
    .addSubcommand(s=>s.setName('ticket-kategori').setDescription('Ticket kategori').addChannelOption(o=>o.setName('kanal').setDescription('Kategori').setRequired(true).addChannelTypes(ChannelType.GuildCategory)))
    .addSubcommand(s=>s.setName('kayit').setDescription('Kayıt log kanalı').addChannelOption(o=>o.setName('kanal').setDescription('Kanal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s=>s.setName('yetkili-log').setDescription('Yetkili log kanalı').addChannelOption(o=>o.setName('kanal').setDescription('Kanal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s=>s.setName('basvuru-kanal').setDescription('Başvuru log kanalı').addChannelOption(o=>o.setName('kanal').setDescription('Kanal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s=>s.setName('ses-log').setDescription('Ses log kanalı').addChannelOption(o=>o.setName('kanal').setDescription('Kanal').setRequired(true).addChannelTypes(ChannelType.GuildText)))
    .addSubcommand(s=>s.setName('mute-rol').setDescription('Mute rolü').addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand(s=>s.setName('kayitsiz-rol').setDescription('Kayıtsız rolü').addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand(s=>s.setName('kayitli-rol').setDescription('Kayıtlı rolü').addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand(s=>s.setName('erkek-rol').setDescription('Erkek rolü').addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand(s=>s.setName('kadin-rol').setDescription('Kız rolü').addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand(s=>s.setName('mod-rol').setDescription('Moderatör rolü').addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand(s=>s.setName('admin-rol').setDescription('Admin rolü').addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand(s=>s.setName('yetkili-rolu').setDescription('Duyuru/bildirim alacak yetkili rolü — sesmute, toplanti, basvuru bildirimleri bu role gider').addRoleOption(o=>o.setName('rol').setDescription('Yetkili rol').setRequired(true)))
    .addSubcommand(s=>s.setName('bilgi').setDescription('Mevcut ayarlar')),
  cooldown:3,
  async execute(i) {
    const sub=i.options.getSubcommand(); const guild=getGuild(i.guildId);
    if (sub==='bilgi') {
      const c=guild.channels; const r=guild.roles;
      return i.reply({embeds:[E.info('⚙️ Sunucu Ayarları',
        '**Log:** '+(c.log?'<#'+c.log+'>':'—')+' | **Ticket:** '+(c.ticket?'<#'+c.ticket+'>':'—')+'\n'+
        '**Ticket Kat:** '+(c.ticketCategory?'<#'+c.ticketCategory+'>':'—')+' | **Kayıt:** '+(c.kayit?'<#'+c.kayit+'>':'—')+'\n'+
        '**Başvuru:** '+(c.basvuruKanal?'<#'+c.basvuruKanal+'>':'—')+' | **Ses Log:** '+(c.sesLog?'<#'+c.sesLog+'>':'—')+'\n'+
        '**Mute:** '+(r.mute?'<@&'+r.mute+'>':'—')+' | **Kayıtsız:** '+(r.unregistered?'<@&'+r.unregistered+'>':'—')+'\n'+
        '**Kayıtlı:** '+(r.kayitli?'<@&'+r.kayitli+'>':'—')+' | **Erkek:** '+(r.erkek?'<@&'+r.erkek+'>':'—')+' | **Kız:** '+(r.kadin?'<@&'+r.kadin+'>':'—')+'\n'+
        '**Mod:** '+(r.mod?'<@&'+r.mod+'>':'—')+' | **Admin:** '+(r.admin?'<@&'+r.admin+'>':'—')+'\n'+
        '**Yetkili Bildirim Rolü:** '+(r.yetkiliRol?'<@&'+r.yetkiliRol+'>':'— (mod rolü kullanılır)')
      )],ephemeral:true});
    }
    const chSubs={log:'log',ticket:'ticket','ticket-kategori':'ticketCategory',kayit:'kayit','yetkili-log':'yetkiliLog','basvuru-kanal':'basvuruKanal','ses-log':'sesLog'};
    const rSubs={'mute-rol':'mute','kayitsiz-rol':'unregistered','kayitli-rol':'kayitli','erkek-rol':'erkek','kadin-rol':'kadin','mod-rol':'mod','admin-rol':'admin','yetkili-rolu':'yetkiliRol'};
    if (chSubs[sub]) { const ch=i.options.getChannel('kanal'); guild.channels[chSubs[sub]]=ch.id; saveDB(); return i.reply({embeds:[E.ok('Ayarlandı','`'+sub+'` -> '+ch)],ephemeral:true}); }
    if (rSubs[sub])  { const rol=i.options.getRole('rol'); guild.roles[rSubs[sub]]=rol.id; saveDB(); return i.reply({embeds:[E.ok('Ayarlandı','`'+sub+'` -> '+rol)],ephemeral:true}); }
  }
},

// ─── /ticketsetup ──────────────────────────
{ data:new SlashCommandBuilder().setName('ticketsetup').setDescription('Ticket sistemini konfigüre et').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s=>s.setName('renk').setDescription('Panel rengi').addStringOption(o=>o.setName('hex').setDescription('Hex renk (#ff0000)').setRequired(true)))
    .addSubcommand(s=>s.setName('resim').setDescription('Panel resmi').addStringOption(o=>o.setName('url').setDescription('Resim URL').setRequired(true)))
    .addSubcommand(s=>s.setName('aciklama').setDescription('Panel açıklaması').addStringOption(o=>o.setName('metin').setDescription('Açıklama').setRequired(true)))
    .addSubcommand(s=>s.setName('sorumlu-rol').setDescription('Sorumlu rol').addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand(s=>s.setName('gonder').setDescription('Paneli bu kanala gönder'))
    .addSubcommand(s=>s.setName('bilgi').setDescription('Ticket ayarları')),
  cooldown:5,
  async execute(i) {
    const sub=i.options.getSubcommand(); const guild=getGuild(i.guildId);
    if (!guild.ticket) guild.ticket={image:null,color:'#5865F2',description:null,sorumluRol:null};
    if (sub==='renk') {
      const hex=i.options.getString('hex');
      if (!/^#[0-9A-Fa-f]{6}$/.test(hex)) return i.reply({embeds:[E.err('Hata','Geçersiz hex. Örn: `#ff0000`')],ephemeral:true});
      guild.ticket.color=hex; saveDB();
      return i.reply({embeds:[new EmbedBuilder().setColor(parseInt(hex.replace('#',''),16)).setTitle('✅ Renk Ayarlandı').setDescription('Panel rengi **'+hex+'** yapıldı.')],ephemeral:true});
    }
    if (sub==='resim') { guild.ticket.image=i.options.getString('url'); saveDB(); return i.reply({embeds:[E.ok('Resim Ayarlandı','Panel resmi güncellendi.')],ephemeral:true}); }
    if (sub==='aciklama') { guild.ticket.description=i.options.getString('metin'); saveDB(); return i.reply({embeds:[E.ok('Açıklama Ayarlandı','Panel açıklaması güncellendi.')],ephemeral:true}); }
    if (sub==='sorumlu-rol') { guild.ticket.sorumluRol=i.options.getRole('rol').id; saveDB(); return i.reply({embeds:[E.ok('Rol Ayarlandı','Sorumlu rol: '+i.options.getRole('rol'))],ephemeral:true}); }
    if (sub==='gonder') { await sendTicketPanel(i.channel,guild,i.guild); return i.reply({embeds:[E.ok('Gönderildi','Ticket paneli bu kanala gönderildi.')],ephemeral:true}); }
    if (sub==='bilgi') {
      const t=guild.ticket;
      return i.reply({embeds:[new EmbedBuilder().setColor(parseInt((t.color||'#5865F2').replace('#',''),16)||0x5865F2).setTitle('🎫 Ticket Ayarları')
        .addFields({name:'Renk',value:t.color||'#5865F2',inline:true},{name:'Sorumlu Rol',value:t.sorumluRol?'<@&'+t.sorumluRol+'>':'—',inline:true},{name:'Resim',value:t.image||'Yok'},{name:'Açıklama',value:t.description||'Varsayılan'})
        .setTimestamp()],ephemeral:true});
    }
  }
},

// ─── /sistem ───────────────────────────────
{ data:new SlashCommandBuilder().setName('sistem').setDescription('Sistemleri aç/kapat').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(o=>o.setName('sistem').setDescription('Sistem').setRequired(true).addChoices(
      {name:'Ticket',value:'ticket'},{name:'Kayıt',value:'kayit'},{name:'Anti-Spam',value:'antiSpam'},
      {name:'Blacklist',value:'blacklist'},{name:'Davet',value:'davet'},{name:'Coin',value:'coin'},{name:'Ses',value:'ses'}
    )).addBooleanOption(o=>o.setName('durum').setDescription('Açık/Kapalı').setRequired(true)),
  cooldown:3,
  async execute(i) {
    const sistem=i.options.getString('sistem'); const durum=i.options.getBoolean('durum');
    const guild=getGuild(i.guildId); guild.systems[sistem]=durum; saveDB();
    await i.reply({embeds:[E.ok('Sistem Güncellendi','**'+sistem+'** -> '+(durum?'✅ Açık':'❌ Kapalı'))]});
  }
},

// ─── /stats ────────────────────────────────
{ data:new SlashCommandBuilder().setName('stats').setDescription('Kullanıcı istatistikleri').addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı')),
  cooldown:5,
  async execute(i) {
    const target=i.options.getUser('kullanici')||i.user;
    const member=await i.guild.members.fetch(target.id).catch(()=>null);
    const data=getUser(target.id,i.guildId);
    const warns=data.punishments.filter(p=>p.type==='warn').length;
    const bans=data.punishments.filter(p=>p.type==='ban').length;
    const kicks=data.punishments.filter(p=>p.type==='kick').length;
    const mutes=data.punishments.filter(p=>p.type==='mute').length;
    const voiceH=Math.floor((data.stats.voiceMinutes||0)/60);
    const voiceM=(data.stats.voiceMinutes||0)%60;
    const topRole=member?.roles.cache.filter(r=>r.id!==i.guildId).sort((a,b)=>b.position-a.position).first();
    const joinAt=member?.joinedTimestamp?'<t:'+Math.floor(member.joinedTimestamp/1000)+':R>':'—';
    const createAt='<t:'+Math.floor(target.createdTimestamp/1000)+':R>';
    const allUsers=Object.values(db.data.users).filter(u=>u.guildId===i.guildId);
    const coinRank=allUsers.sort((a,b)=>(b.coin||0)-(a.coin||0)).findIndex(u=>u.userId===target.id)+1;
    const msgRank=allUsers.sort((a,b)=>(b.stats?.messages||0)-(a.stats?.messages||0)).findIndex(u=>u.userId===target.id)+1;
    const totalStaff=Object.values(data.staffStats||{}).reduce((a,v)=>a+v,0);
    const embed=new EmbedBuilder()
      .setColor(member?.displayHexColor&&member.displayHexColor!=='#000000'?member.displayHexColor:0x5865F2)
      .setAuthor({name:target.tag,iconURL:target.displayAvatarURL()})
      .setThumbnail(target.displayAvatarURL({size:256}))
      .setDescription((topRole?''+topRole+'\n':'')+'\n> 🆔 `'+target.id+'`\n> 📅 Hesap: '+createAt+'\n> 📥 Katılım: '+joinAt)
      .addFields(
        {name:'━━━ 📊 Aktivite ━━━',value:'\u200b',inline:false},
        {name:'💬 Mesaj',value:'`'+(data.stats.messages||0).toLocaleString()+'`\n#'+coinRank+' sıra',inline:true},
        {name:'🔊 Ses',value:'`'+voiceH+'s '+voiceM+'dk`',inline:true},
        {name:'📨 Davet',value:'`'+(data.stats.invites||0)+'`',inline:true},
        {name:'━━━ 💰 Ekonomi ━━━',value:'\u200b',inline:false},
        {name:'💰 Coin',value:'`'+(data.coin||0).toLocaleString()+'`\n#'+coinRank+' sıra',inline:true},
        {name:'📈 Kazanılan',value:'`'+(data.totalCoin||0).toLocaleString()+'`',inline:true},
        {name:'🔥 Seri',value:'`'+(data.daily?.streak||0)+' gün`',inline:true},
        {name:'━━━ ⚠️ Cezalar ━━━',value:'\u200b',inline:false},
        {name:'⚠️ Uyarı',value:'`'+warns+'`',inline:true},
        {name:'🔇 Mute',value:'`'+mutes+'`',inline:true},
        {name:'👢 Kick',value:'`'+kicks+'`',inline:true},
        {name:'🔨 Ban',value:'`'+bans+'`',inline:true},
        {name:'📋 Toplam',value:'`'+data.punishments.length+'`',inline:true},
        {name:'\u200b',value:'\u200b',inline:true},
      );
    if (totalStaff>0) {
      embed.addFields(
        {name:'━━━ 🛡️ Yetkili Stats ━━━',value:'\u200b',inline:false},
        {name:'✅ Kayıt',value:'`'+(data.staffStats.kayits||0)+'`',inline:true},
        {name:'🔨 Ban',value:'`'+(data.staffStats.bans||0)+'`',inline:true},
        {name:'👢 Kick',value:'`'+(data.staffStats.kicks||0)+'`',inline:true},
        {name:'🔇 Mute',value:'`'+(data.staffStats.mutes||0)+'`',inline:true},
        {name:'⚠️ Warn',value:'`'+(data.staffStats.warns||0)+'`',inline:true},
        {name:'🎫 Ticket',value:'`'+(data.staffStats.tickets||0)+'`',inline:true},
      );
    }
    embed.setFooter({text:'Prox Bot • '+i.guild.name,iconURL:i.guild.iconURL()||undefined}).setTimestamp();
    await i.reply({embeds:[embed]});
  }
},

// ─── /coin ─────────────────────────────────
{ data:new SlashCommandBuilder().setName('coin').setDescription('Coin sistemi')
    .addSubcommand(s=>s.setName('bakiye').setDescription('Bakiye').addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı')))
    .addSubcommand(s=>s.setName('gunluk').setDescription('Günlük coin al'))
    .addSubcommand(s=>s.setName('ver').setDescription('Coin ver').addUserOption(o=>o.setName('kullanici').setDescription('Kime').setRequired(true)).addIntegerOption(o=>o.setName('miktar').setDescription('Miktar').setRequired(true).setMinValue(1)))
    .addSubcommand(s=>s.setName('ekle').setDescription('Coin ekle [Admin]').addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)).addIntegerOption(o=>o.setName('miktar').setDescription('Miktar').setRequired(true).setMinValue(1))),
  cooldown:3,
  async execute(i) {
    const sub=i.options.getSubcommand(); const self=getUser(i.user.id,i.guildId); const DAILY=Number(process.env.DAILY_COIN)||100;
    if (sub==='bakiye') {
      const t=i.options.getUser('kullanici')||i.user; const d=getUser(t.id,i.guildId);
      return i.reply({embeds:[new EmbedBuilder().setColor(0xf1c40f).setTitle('💰 '+t.username+' — Coin').setThumbnail(t.displayAvatarURL())
        .addFields({name:'Mevcut',value:'`'+(d.coin||0).toLocaleString()+' 💰`',inline:true},{name:'Toplam',value:'`'+(d.totalCoin||0).toLocaleString()+' 💰`',inline:true},{name:'🔥 Seri',value:'`'+(d.daily?.streak||0)+' gün`',inline:true}).setTimestamp()]});
    }
    if (sub==='gunluk') {
      const now=Date.now(); const last=self.daily?.lastClaim||0;
      if (now-last<86400000) { const kalan=Math.ceil((86400000-(now-last))/3600000); return i.reply({embeds:[E.err('Cooldown','Günlük coinini aldın! **'+kalan+' saat** sonra tekrar dene.')],ephemeral:true}); }
      const streak=(now-last)<172800000?(self.daily?.streak||0)+1:1; const bonus=Math.min(streak*10,200); const total=DAILY+bonus;
      self.coin=(self.coin||0)+total; self.totalCoin=(self.totalCoin||0)+total; self.daily={lastClaim:now,streak}; saveDB();
      return i.reply({embeds:[E.ok('Günlük Coin','**+'+total+' 💰** aldın!\n🔥 Seri: **'+streak+' gün** (+'+bonus+' bonus)\n💰 Bakiye: **'+self.coin+'**')]});
    }
    if (sub==='ver') {
      const t=i.options.getUser('kullanici'); const m=i.options.getInteger('miktar');
      if (t.id===i.user.id) return i.reply({embeds:[E.err('Hata','Kendine coin veremezsin.')],ephemeral:true});
      if ((self.coin||0)<m) return i.reply({embeds:[E.err('Yetersiz','Bakiye: **'+(self.coin||0)+'**')],ephemeral:true});
      const rec=getUser(t.id,i.guildId); self.coin-=m; rec.coin=(rec.coin||0)+m; saveDB();
      return i.reply({embeds:[E.ok('Transfer','**'+m+' 💰** -> '+t+'\nKalan: **'+self.coin+'**')]});
    }
    if (sub==='ekle') {
      if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) return i.reply({embeds:[E.err('Yetki','Admin yetkisi gerekli.')],ephemeral:true});
      const t=i.options.getUser('kullanici'); const m=i.options.getInteger('miktar');
      const rec=getUser(t.id,i.guildId); rec.coin=(rec.coin||0)+m; rec.totalCoin=(rec.totalCoin||0)+m; saveDB();
      return i.reply({embeds:[E.ok('Coin Eklendi',t.tag+' -> **+'+m+' 💰**')]});
    }
  }
},

// ─── /blacklist ────────────────────────────
{ data:new SlashCommandBuilder().setName('blacklist').setDescription('Blacklist yönetimi').setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(s=>s.setName('ekle-kelime').setDescription('Kelime ekle').addStringOption(o=>o.setName('kelime').setDescription('Kelime').setRequired(true)))
    .addSubcommand(s=>s.setName('sil-kelime').setDescription('Kelime sil').addStringOption(o=>o.setName('kelime').setDescription('Kelime').setRequired(true)))
    .addSubcommand(s=>s.setName('ekle-kullanici').setDescription('Kullanıcı ekle').addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)).addStringOption(o=>o.setName('sebep').setDescription('Sebep')))
    .addSubcommand(s=>s.setName('sil-kullanici').setDescription('Kullanıcı sil').addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)))
    .addSubcommand(s=>s.setName('ekle-sunucu').setDescription('Blacklist sunucu ekle').addStringOption(o=>o.setName('sunucu_id').setDescription('Sunucu ID').setRequired(true)).addStringOption(o=>o.setName('sunucu_adi').setDescription('Sunucu adı').setRequired(true)).addStringOption(o=>o.setName('sebep').setDescription('Sebep')))
    .addSubcommand(s=>s.setName('sil-sunucu').setDescription('Blacklist sunucu sil').addStringOption(o=>o.setName('sunucu_id').setDescription('Sunucu ID').setRequired(true)))
    .addSubcommand(s=>s.setName('liste').setDescription('Blacklist listesi')),
  cooldown:3,
  async execute(i) {
    const sub=i.options.getSubcommand();
    if (!db.data.blacklistGuilds) db.data.blacklistGuilds=[];
    if (sub==='ekle-kelime') {
      const k=i.options.getString('kelime').toLowerCase();
      if (db.data.blacklist.find(b=>b.guildId===i.guildId&&b.type==='word'&&b.value===k)) return i.reply({embeds:[E.err('Zaten Var','Bu kelime zaten listede.')],ephemeral:true});
      db.data.blacklist.push({guildId:i.guildId,type:'word',value:k,addedBy:i.user.id,addedAt:Date.now()}); saveDB();
      return i.reply({embeds:[E.ok('Eklendi','`'+k+'` blackliste eklendi.')],ephemeral:true});
    }
    if (sub==='sil-kelime') {
      const k=i.options.getString('kelime').toLowerCase();
      db.data.blacklist=db.data.blacklist.filter(b=>!(b.guildId===i.guildId&&b.type==='word'&&b.value===k)); saveDB();
      return i.reply({embeds:[E.ok('Silindi','`'+k+'` kaldırıldı.')],ephemeral:true});
    }
    if (sub==='ekle-kullanici') {
      const t=i.options.getUser('kullanici'); const s=i.options.getString('sebep')||'Blacklist';
      if (db.data.blacklist.find(b=>b.guildId===i.guildId&&b.type==='user'&&b.value===t.id))
        return i.reply({embeds:[E.err('Zaten Var','Bu kullanıcı zaten blacklistte.')],ephemeral:true});
      db.data.blacklist.push({guildId:i.guildId,type:'user',value:t.id,reason:s,addedBy:i.user.id,addedAt:Date.now()}); saveDB();
      // Şu an sunucudaysa hemen ban at
      const member=i.guild.members.cache.get(t.id)||await i.guild.members.fetch(t.id).catch(()=>null);
      if (member&&member.bannable) {
        await member.ban({reason:'Blacklist: '+s,deleteMessageSeconds:0}).catch(()=>{});
        return i.reply({embeds:[E.ok('Eklendi ve Banlandı',t.tag+' blackliste alindi ve **sunucudan banlandı**.\n**Sebep:** '+s)],ephemeral:true});
      }
      return i.reply({embeds:[E.ok('Eklendi',t.tag+' blackliste alindi. Sunucuya girince otomatik banlanacak.\n**Sebep:** '+s)],ephemeral:true});
    }
    if (sub==='sil-kullanici') {
      const t=i.options.getUser('kullanici');
      db.data.blacklist=db.data.blacklist.filter(b=>!(b.guildId===i.guildId&&b.type==='user'&&b.value===t.id)); saveDB();
      return i.reply({embeds:[E.ok('Silindi',t.tag+' kaldırıldı.')],ephemeral:true});
    }
    if (sub==='ekle-sunucu') {
      const sid=i.options.getString('sunucu_id'); const sadi=i.options.getString('sunucu_adi'); const sebep=i.options.getString('sebep')||'Belirtilmedi';
      if (db.data.blacklistGuilds.find(g=>g.guildId===sid)) return i.reply({embeds:[E.err('Zaten Var','Bu sunucu zaten blacklistte.')],ephemeral:true});
      db.data.blacklistGuilds.push({guildId:sid,name:sadi,reason:sebep,addedBy:i.user.id,addedAt:Date.now()}); saveDB();
      return i.reply({embeds:[E.ok('Eklendi','**'+sadi+'** (`'+sid+'`) blackliste eklendi.\n**Sebep:** '+sebep)],ephemeral:true});
    }
    if (sub==='sil-sunucu') {
      const sid=i.options.getString('sunucu_id');
      const entry=db.data.blacklistGuilds.find(g=>g.guildId===sid);
      if (!entry) return i.reply({embeds:[E.err('Bulunamadı','Bu sunucu blacklistte değil.')],ephemeral:true});
      db.data.blacklistGuilds=db.data.blacklistGuilds.filter(g=>g.guildId!==sid); saveDB();
      return i.reply({embeds:[E.ok('Silindi','**'+entry.name+'** kaldırıldı.')],ephemeral:true});
    }
    if (sub==='liste') {
      const words=db.data.blacklist.filter(b=>b.guildId===i.guildId&&b.type==='word');
      const users=db.data.blacklist.filter(b=>b.guildId===i.guildId&&b.type==='user');
      const guilds=db.data.blacklistGuilds||[];
      const embed=new EmbedBuilder().setColor(0xe74c3c).setTitle('🚫 Blacklist')
        .addFields(
          {name:'📝 Kelimeler ('+words.length+')',value:words.length?words.map(w=>'`'+w.value+'`').join(', '):'Yok'},
          {name:'👤 Kullanıcılar ('+users.length+')',value:users.length?users.map(u=>'<@'+u.value+'> — '+u.reason).join('\n'):'Yok'},
          {name:'🏠 Sunucular ('+guilds.length+')',value:guilds.length?guilds.map(g=>'**'+g.name+'** (`'+g.guildId+'`) — '+g.reason).join('\n'):'Yok'},
        ).setTimestamp();
      return i.reply({embeds:[embed],ephemeral:true});
    }
  }
},

// ─── /blacklistkontrol ─────────────────────
{ data:new SlashCommandBuilder().setName('blacklistkontrol').setDescription('Tüm üyeleri blacklist kontrolünden geçir').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  cooldown:60,
  async execute(i,client) {
    if (!db.data.blacklistGuilds||db.data.blacklistGuilds.length===0)
      return i.reply({embeds:[E.warn('Blacklist Boş','Önce `/blacklist ekle-sunucu` ile sunucu ekle.')],ephemeral:true});
    await i.guild.members.fetch();
    const members=[...i.guild.members.cache.values()].filter(m=>!m.user.bot);
    const total=members.length;
    await i.reply({embeds:[new EmbedBuilder().setColor(0xf39c12).setTitle('🔍 Blacklist Kontrolü Başlatıldı')
      .setDescription('Tüm sunucu üyeleri için blacklist kontrolü başlatılıyor, bu işlem biraz zaman alabilir.\n\n**Toplam '+total+' üye** kontrol edilecek.')
      .setFooter({text:'Prox Bot • Lütfen bekleyin...'}).setTimestamp()]});
    const startTime=Date.now();
    let checked=0,detected=0;
    const progressMsg=await i.channel.send({embeds:[new EmbedBuilder().setColor(0x3498db).setTitle('⏳ Başlatılıyor...')]});
    for (const member of members) {
      checked++;
      const memberGuilds=client.guilds.cache.filter(g=>g.members.cache.has(member.id)&&g.id!==i.guild.id);
      const hitGuild=memberGuilds.find(g=>db.data.blacklistGuilds.some(bg=>bg.guildId===g.id));
      if (hitGuild) {
        detected++;
        const bgEntry=db.data.blacklistGuilds.find(bg=>bg.guildId===hitGuild.id);
        await member.user.send({embeds:[E.warn('⚠️ Blacklist Sunucu Uyarısı',
          '**'+i.guild.name+'** sunucusunda blacklist tespiti yapıldı.\n\n**Sunucu:** '+hitGuild.name+' (`'+hitGuild.id+'`)\n**Sebep:** '+(bgEntry?.reason||'—')
        )]}).catch(()=>{});
        const gData=getGuild(i.guildId);
        const logCh=i.guild.channels.cache.get(gData.channels.log);
        if (logCh) logCh.send({embeds:[new EmbedBuilder().setColor(0xe74c3c).setTitle('🚨 Blacklist Tespit')
          .setDescription('<@'+member.id+'> ('+member.user.tag+')')
          .addFields({name:'Sunucu',value:hitGuild.name+' (`'+hitGuild.id+'`)',inline:true},{name:'Sebep',value:bgEntry?.reason||'—',inline:true})
          .setTimestamp()]}).catch(()=>{});
      }
      if (checked%20===0||checked===total) {
        const el=((Date.now()-startTime)/1000).toFixed(1);
        const rate=checked/(Date.now()-startTime+1)*1000;
        const eta=rate>0?((total-checked)/rate).toFixed(1):'...';
        const pct=Math.floor(checked/total*20);
        await progressMsg.edit({embeds:[new EmbedBuilder()
          .setColor(checked===total?0x2ecc71:0x3498db)
          .setTitle((checked===total?'✅ Tamamlandı':'⏳ İlerleme')+' — '+checked+'/'+total)
          .setDescription(
            '**'+checked+'/'+total+'** üye kontrol edildi\n\n'+
            '🚨 **'+detected+' blacklist tespit**\n'+
            '⏱ Geçen: **'+el+' sn**'+(checked<total?' | Tahmini: **'+eta+' sn**':'')
          )
          .addFields({name:'İlerleme',value:'`'+'█'.repeat(pct)+'░'.repeat(20-pct)+'` '+Math.floor(checked/total*100)+'%'})
          .setTimestamp()]}).catch(()=>{});
      }
      if (checked%50===0) await new Promise(r=>setTimeout(r,1000));
    }
  }
},

// ─── /ses ──────────────────────────────────
{ data:new SlashCommandBuilder().setName('ses').setDescription('Ses sistemi').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s=>s.setName('rol-ayarla').setDescription('Ses rolü').addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand(s=>s.setName('toplanti-ac').setDescription('Toplantı aç — kanal seç, duyuru at')
      .addChannelOption(o=>o.setName('kanal').setDescription('Toplantı ses kanalı').setRequired(true).addChannelTypes(ChannelType.GuildVoice))
      .addStringOption(o=>o.setName('duyuru').setDescription('Yetkililere DM duyurusu (boş=varsayılan)')))
    .addSubcommand(s=>s.setName('toplanti-kapat').setDescription('Toplantı kapat'))
    .addSubcommand(s=>s.setName('duyuru').setDescription('Yetkililere DM duyurusu gönder').addStringOption(o=>o.setName('mesaj').setDescription('Duyuru mesajı').setRequired(true)))
    .addSubcommand(s=>s.setName('bilgi').setDescription('Ses ayarları')),
  cooldown:5,
  async execute(i) {
    const sub=i.options.getSubcommand(); const guild=getGuild(i.guildId);
    if (sub==='rol-ayarla') { const rol=i.options.getRole('rol'); guild.roles.sesRol=rol.id; guild.systems.ses=true; saveDB(); return i.reply({embeds:[E.ok('Ayarlandı','Ses rolü: '+rol)]}); }
    if (sub==='toplanti-ac') {
      const kanal=i.options.getChannel('kanal');
      const duyuruMesaj=i.options.getString('duyuru')||('📢 **Toplantı Başlıyor!**\n\n**Kanal:** '+kanal.name+'\n**Başlatan:** '+i.user.tag+'\n**Sunucu:** '+i.guild.name+'\n\nLütfen ses kanalına katıl!');
      // Kanalı kaydet
      guild.channels.meetingChannel=kanal.id; saveDB();
      // O kanalda olanları mute et
      await i.guild.members.fetch().catch(()=>{});
      const mems=i.guild.members.cache.filter(m=>m.voice.channelId===kanal.id&&!m.user.bot); let cnt=0;
      for (const m of mems.values()){await m.voice.setMute(true).catch(()=>{}); cnt++;}
      guild.systems.meeting=true; saveDB();
      // Yetkililere DM duyurusu
      const modRolId=getNotifRolId(guild);
      let dmCnt=0;
      if (modRolId) {
        const modRol=i.guild.roles.cache.get(modRolId);
        if (modRol) {
          for (const [,m] of modRol.members) {
            if (m.user.bot) continue;
            await m.user.send({embeds:[new EmbedBuilder().setColor(0xf39c12).setTitle('📢 Toplantı Başlıyor!')
              .setDescription(duyuruMesaj)
              .addFields({name:'📅 Zaman',value:'<t:'+Math.floor(Date.now()/1000)+':F>',inline:true},{name:'🎙️ Kanal',value:kanal.name,inline:true})
              .setThumbnail(i.guild.iconURL()).setTimestamp()]}).catch(()=>{}); dmCnt++;
          }
        }
      }
      return i.reply({embeds:[E.ok('Toplantı Açıldı',
        '**Kanal:** '+kanal+'\n**Susturulan:** '+cnt+' üye\n**DM Gönderilen:** '+dmCnt+' yetkili'
      )]});
    }
    if (sub==='toplanti-kapat') {
      const mchId=guild.channels.meetingChannel;
      await i.guild.members.fetch().catch(()=>{});
      const mems=mchId
        ? i.guild.members.cache.filter(m=>m.voice.channelId===mchId&&!m.user.bot)
        : i.guild.members.cache.filter(m=>m.voice.channel&&!m.user.bot);
      for (const m of mems.values()) await m.voice.setMute(false).catch(()=>{});
      guild.systems.meeting=false; delete guild.channels.meetingChannel; saveDB();
      return i.reply({embeds:[E.ok('Toplantı Kapatıldı','Tüm üyelerin sesi açıldı.')]});
    }
    if (sub==='duyuru') {
      const mesaj=i.options.getString('mesaj');
      const modRolId=getNotifRolId(guild);
      let cnt=0;
      if (modRolId) {
        const modRol=i.guild.roles.cache.get(modRolId);
        if (modRol) {
          for (const [,m] of modRol.members) {
            if (m.user.bot) continue;
            await m.user.send({embeds:[new EmbedBuilder().setColor(0x3498db).setTitle('📢 Sunucu Duyurusu')
              .setDescription(mesaj)
              .setFooter({text:i.guild.name+' • '+i.user.tag}).setTimestamp()]}).catch(()=>{}); cnt++;
          }
        }
      }
      return i.reply({embeds:[E.ok('Duyuru Gönderildi','**'+cnt+'** yetkili DM aldı.')],ephemeral:true});
    }
    if (sub==='bilgi') return i.reply({embeds:[E.info('🔊 Ses Sistemi',
      '**Ses Rolü:** '+(guild.roles.sesRol?'<@&'+guild.roles.sesRol+'>':'—')+'\n'+
      '**Durum:** '+(guild.systems.ses?'✅':'❌')+'\n'+
      '**Toplantı:** '+(guild.systems.meeting?'🔴 Açık':'⚫ Kapalı')
    )],ephemeral:true});
  }
},

// ─── /cekilis ──────────────────────────────
{ data:new SlashCommandBuilder().setName('cekilis').setDescription('Çekiliş sistemi').setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents)
    .addSubcommand(s=>s.setName('baslat').setDescription('Çekiliş başlat').addStringOption(o=>o.setName('odul').setDescription('Ödül').setRequired(true)).addStringOption(o=>o.setName('sure').setDescription('Süre: 10m 1h 1d').setRequired(true)).addIntegerOption(o=>o.setName('kazanan').setDescription('Kazanan sayısı').setMinValue(1).setMaxValue(10)))
    .addSubcommand(s=>s.setName('bitis').setDescription('Çekilişi bitir').addStringOption(o=>o.setName('mesaj_id').setDescription('Mesaj ID').setRequired(true)))
    .addSubcommand(s=>s.setName('liste').setDescription('Aktif çekilişler')),
  cooldown:5,
  async execute(i) {
    const sub=i.options.getSubcommand();
    if (sub==='baslat') {
      const odul=i.options.getString('odul'); const sureStr=i.options.getString('sure'); const kazanan=i.options.getInteger('kazanan')||1;
      const msVal=ms(sureStr); if (!msVal) return i.reply({embeds:[E.err('Hata','Geçersiz süre.')],ephemeral:true});
      const bitis=Date.now()+msVal;
      const embed=new EmbedBuilder().setColor(0xf1c40f).setTitle('🎉 ÇEKİLİŞ')
        .setDescription('**Ödül:** '+odul+'\n**Kazanan:** '+kazanan+' kişi\n**Bitiş:** <t:'+Math.floor(bitis/1000)+':R>\n**Başlatan:** '+i.user)
        .setFooter({text:'Katılmak için tıkla!'}).setTimestamp(bitis);
      const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('giveaway_join').setLabel('🎉 Katıl').setStyle(ButtonStyle.Success));
      await i.reply({embeds:[E.ok('Başladı','Çekiliş başlatıldı!')],ephemeral:true});
      const msg=await i.channel.send({embeds:[embed],components:[row]});
      db.data.giveaways[msg.id]={messageId:msg.id,channelId:i.channelId,guildId:i.guildId,prize:odul,winnerCount:kazanan,endsAt:bitis,hostId:i.user.id,participants:[],ended:false}; saveDB();
      setTimeout(()=>endGiveaway(msg.id,i.channel),msVal);
    }
    if (sub==='bitis') { await endGiveaway(i.options.getString('mesaj_id'),i.channel); await i.reply({embeds:[E.ok('Bitti','Çekiliş sonlandırıldı.')],ephemeral:true}); }
    if (sub==='liste') {
      const active=Object.values(db.data.giveaways).filter(g=>g.guildId===i.guildId&&!g.ended);
      if (!active.length) return i.reply({embeds:[E.info('Çekilişler','Aktif çekiliş yok.')],ephemeral:true});
      return i.reply({embeds:[new EmbedBuilder().setColor(0xf1c40f).setTitle('🎉 Aktif Çekilişler')
        .setDescription(active.map(g=>'**'+g.prize+'** — <t:'+Math.floor(g.endsAt/1000)+':R> — '+g.participants.length+' katılımcı').join('\n')).setTimestamp()],ephemeral:true});
    }
  }
},

// ─── /davet ────────────────────────────────
{ data:new SlashCommandBuilder().setName('davet').setDescription('Davet istatistikleri').addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı')),
  cooldown:5,
  async execute(i) {
    const t=i.options.getUser('kullanici')||i.user;
    const inv=db.data.invites?.[i.guildId]?.[t.id]||{total:0,members:[]};
    await i.reply({embeds:[new EmbedBuilder().setColor(0x3498db).setTitle('📨 '+t.username+' — Davetler').setThumbnail(t.displayAvatarURL())
      .addFields({name:'Toplam',value:'`'+inv.total+'`',inline:true},{name:'Kişi',value:'`'+(inv.members?.length||0)+'`',inline:true}).setTimestamp()]});
  }
},

// ─── /yetkilibasvuru ───────────────────────
{ data:new SlashCommandBuilder().setName('yetkilibasvuru').setDescription('Yetkili başvuru sistemi')
    .addSubcommand(s=>s.setName('ac').setDescription('Başvuruları aç'))
    .addSubcommand(s=>s.setName('kapat').setDescription('Başvuruları kapat'))
    .addSubcommand(s=>s.setName('soru-ekle').setDescription('Soru ekle (max 5)').addStringOption(o=>o.setName('soru').setDescription('Soru (max 45 karakter)').setRequired(true)))
    .addSubcommand(s=>s.setName('soru-sifirla').setDescription('Tüm soruları sıfırla'))
    .addSubcommand(s=>s.setName('sorular').setDescription('Mevcut soruları göster'))
    .addSubcommand(s=>s.setName('basvur').setDescription('Başvurusu yap')),
  cooldown:5,
  async execute(i) {
    const sub=i.options.getSubcommand(); const guild=getGuild(i.guildId);
    if (!guild.basvuruSorular) guild.basvuruSorular=[];
    const isAdmin=i.member.permissions.has(PermissionFlagsBits.Administrator);
    if (sub==='ac') {
      if (!isAdmin) return i.reply({embeds:[E.err('Yetki','Admin gerekli.')],ephemeral:true});
      guild.systems.basvuru=true; saveDB();
      return i.reply({embeds:[E.ok('Başvuru Açıldı','Üyeler `/yetkilibasvuru basvur` ile başvurabilir.')]});
    }
    if (sub==='kapat') {
      if (!isAdmin) return i.reply({embeds:[E.err('Yetki','Admin gerekli.')],ephemeral:true});
      guild.systems.basvuru=false; saveDB(); return i.reply({embeds:[E.warn('Başvuru Kapatıldı','Yetkili başvuruları devre dışı.')]});
    }
    if (sub==='soru-ekle') {
      if (!isAdmin) return i.reply({embeds:[E.err('Yetki','Admin gerekli.')],ephemeral:true});
      if (guild.basvuruSorular.length>=5) return i.reply({embeds:[E.err('Limit','Maks 5 soru. Sıfırlamak için `/yetkilibasvuru soru-sifirla`')],ephemeral:true});
      const soru=i.options.getString('soru').slice(0,45);
      guild.basvuruSorular.push(soru); saveDB();
      return i.reply({embeds:[E.ok('Soru Eklendi','**'+(guild.basvuruSorular.length)+'.** '+soru)],ephemeral:true});
    }
    if (sub==='soru-sifirla') {
      if (!isAdmin) return i.reply({embeds:[E.err('Yetki','Admin gerekli.')],ephemeral:true});
      guild.basvuruSorular=[]; saveDB(); return i.reply({embeds:[E.ok('Sıfırlandı','Sorular silindi, varsayılanlar kullanılacak.')],ephemeral:true});
    }
    if (sub==='sorular') {
      const list=guild.basvuruSorular.length>0?guild.basvuruSorular:['Kaç yaşındasın?','Daha önce yetkili oldun mu?','Neden yetkili olmak istiyorsun?','Günlük kaç saat aktif olabilirsin?','Eklemek istediğin bir şey?'];
      return i.reply({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('📋 Başvuru Soruları')
        .setDescription(list.map((s,idx)=>'**'+(idx+1)+'.** '+s).join('\n'))
        .setFooter({text:guild.basvuruSorular.length>0?'Özel sorular':'Varsayılan sorular'}).setTimestamp()],ephemeral:true});
    }
    if (sub==='basvur') {
      if (!guild.systems.basvuru) return i.reply({embeds:[E.err('Kapalı','Başvurular şu an kapalı.')],ephemeral:true});
      const key=i.guildId+'_'+i.user.id;
      if (db.data.applications[key]?.status==='pending') return i.reply({embeds:[E.err('Zaten Başvurdun','Bekleyen başvurun var, sonucu bekle.')],ephemeral:true});
      const sorular=guild.basvuruSorular.length>0?guild.basvuruSorular:['Kaç yaşındasın?','Daha önce yetkili oldun mu?','Neden yetkili olmak istiyorsun?','Günlük kaç saat aktif olabilirsin?','Eklemek istediğin bir şey?'];
      const modal=new ModalBuilder().setCustomId('basvuru_modal').setTitle('Yetkili Başvurusu');
      sorular.slice(0,5).forEach((soru,idx)=>{
        modal.addComponents(new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('s'+idx).setLabel(soru.slice(0,45)).setStyle(idx===1||idx===2?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(idx<4)
        ));
      });
      await i.showModal(modal);
    }
  }
},

// ─── /sunucu ───────────────────────────────
{ data:new SlashCommandBuilder().setName('sunucu').setDescription('Sunucu bilgileri'), cooldown:10,
  async execute(i) {
    const g=i.guild; await g.members.fetch().catch(()=>{});
    await i.reply({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('🌐 '+g.name).setThumbnail(g.iconURL())
      .addFields(
        {name:'👑 Sahip',value:'<@'+g.ownerId+'>',inline:true},{name:'👥 Üyeler',value:'`'+g.memberCount+'`',inline:true},{name:'📅 Kuruluş',value:'<t:'+Math.floor(g.createdTimestamp/1000)+':D>',inline:true},
        {name:'💬 Kanallar',value:'`'+g.channels.cache.filter(c=>c.type===0).size+'`',inline:true},{name:'🎭 Roller',value:'`'+g.roles.cache.size+'`',inline:true},{name:'😀 Emojiler',value:'`'+g.emojis.cache.size+'`',inline:true},
        {name:'🤖 Botlar',value:'`'+g.members.cache.filter(m=>m.user.bot).size+'`',inline:true},{name:'👤 İnsanlar',value:'`'+g.members.cache.filter(m=>!m.user.bot).size+'`',inline:true},
        {name:'🔒 Doğrulama',value:'`'+(['Yok','Düşük','Orta','Yüksek','Çok Yüksek'][g.verificationLevel])+'`',inline:true},
      ).setTimestamp()]});
  }
},

// ─── /kullanici ────────────────────────────
{ data:new SlashCommandBuilder().setName('kullanici').setDescription('Kullanıcı bilgileri').addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı')), cooldown:5,
  async execute(i) {
    const target=i.options.getMember('kullanici')||i.member; const user=target.user;
    const createdTs=Math.floor(user.createdTimestamp/1000);
    const joinedTs=Math.floor(target.joinedTimestamp/1000);
    await i.reply({embeds:[new EmbedBuilder().setColor(0x3498db).setTitle('👤 '+user.tag).setThumbnail(user.displayAvatarURL({size:256}))
      .addFields(
        {name:'🆔 ID',value:'`'+user.id+'`',inline:true},
        {name:'📅 Hesap Açılış',value:'<t:'+createdTs+':F>\n(<t:'+createdTs+':R>)',inline:true},
        {name:'📥 Sunucuya Katılım',value:'<t:'+joinedTs+':F>\n(<t:'+joinedTs+':R>)',inline:true},
        {name:'🎭 En Yüksek Rol',value:''+target.roles.highest,inline:true},
        {name:'🎭 Roller ('+(target.roles.cache.size-1)+')',value:target.roles.cache.filter(r=>r.id!==i.guildId).map(r=>''+r).join(' ')||'Yok'},
      ).setTimestamp()]});
  }
},

// ─── /rol ──────────────────────────────────
{ data:new SlashCommandBuilder().setName('rol').setDescription('Rol ver/al').setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s=>s.setName('ver').setDescription('Rol ver').addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)).addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true)))
    .addSubcommand(s=>s.setName('al').setDescription('Rol al').addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true)).addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true))),
  cooldown:3,
  async execute(i) {
    const sub=i.options.getSubcommand(); const target=i.options.getMember('kullanici'); const rol=i.options.getRole('rol');
    if (!target) return i.reply({embeds:[E.err('Hata','Kullanıcı bulunamadı.')],ephemeral:true});
    const guildData=getGuild(i.guildId);
    const isVer = sub==='ver';

    if (isVer) await target.roles.add(rol).catch(()=>{});
    else       await target.roles.remove(rol).catch(()=>{});

    // Yanıt
    const embed=E.ok(isVer?'Rol Verildi':'Rol Alindi',
      '<@'+target.id+'> '+rol+' '+(isVer?'verildi':'alindi')+' | Yetkili: <@'+i.user.id+'>'
    );
    await i.reply({embeds:[embed]});

    // Log kanalı
    const logCh=i.guild.channels.cache.get(guildData.channels.log||guildData.channels.yetkiliLog);
    if (logCh) {
      await logCh.send({embeds:[new EmbedBuilder()
        .setColor(isVer?0x22d3a0:0xf87171)
        .setTitle(isVer?'Rol Verildi':'Rol Alindi')
        .setThumbnail(target.user.displayAvatarURL({size:64}))
        .addFields(
          {name:'👤 Kullanıcı',value:'<@'+target.id+'> (`'+target.user.tag+'`)',inline:true},
          {name:'🎭 Rol',value:'<@&'+rol.id+'> (`'+rol.name+'`)',inline:true},
          {name:'Yetkili',value:'<@'+i.user.id+'> (`'+i.user.tag+'`)',inline:true},
          {name:'Tarih',value:'<t:'+Math.floor(Date.now()/1000)+':F>',inline:true},
        )
        .setTimestamp()
      ]}).catch(()=>{});
    }

    // addLog
    addLog({type:'rol_'+(isVer?'ver':'al'),guildId:i.guildId,targetId:target.id,modId:i.user.id,reason:rol.name});
  }
},

// ─── /yavaslat ─────────────────────────────
{ data:new SlashCommandBuilder().setName('yavaslat').setDescription('Yavaş mod').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addIntegerOption(o=>o.setName('saniye').setDescription('0=kapat').setRequired(true).setMinValue(0).setMaxValue(21600)),
  cooldown:5,
  async execute(i) {
    const sn=i.options.getInteger('saniye'); await i.channel.setRateLimitPerUser(sn);
    await i.reply({embeds:[sn===0?E.ok('Yavaş Mod Kapatıldı','Devre dışı.'):E.warn('Yavaş Mod','**'+sn+'s** olarak ayarlandı.')]});
  }
},

// ─── /kilit ────────────────────────────────
{ data:new SlashCommandBuilder().setName('kilit').setDescription('Kanalı kilitle/aç').setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
    .addSubcommand(s=>s.setName('kapat').setDescription('Kilitle'))
    .addSubcommand(s=>s.setName('ac').setDescription('Aç')),
  cooldown:5,
  async execute(i) {
    const sub=i.options.getSubcommand();
    if (sub==='kapat'){await i.channel.permissionOverwrites.edit(i.guild.id,{SendMessages:false}); return i.reply({embeds:[E.warn('🔒 Kilitlendi','Bu kanal kilitlendi.')]});}
    await i.channel.permissionOverwrites.edit(i.guild.id,{SendMessages:null}); return i.reply({embeds:[E.ok('🔓 Açıldı','Bu kanal açıldı.')]});
  }
},

// ─── /sablon ───────────────────────────────
{ data:new SlashCommandBuilder().setName('sablon').setDescription('Prox şablonunu kur').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  cooldown:30,
  async execute(i) {
    if (i.user.id!==i.guild.ownerId) return i.reply({embeds:[E.err('Yetki','Sadece sunucu sahibi kullanabilir.')],ephemeral:true});
    const embed=new EmbedBuilder().setColor(0xf39c12).setTitle('⚠️ Şablon Kurulumu')
      .setDescription('**Dikkat!** Mevcut tüm kanallar ve roller **kalıcı olarak silinir**.\n**Devam?**')
      .setFooter({text:'Bu işlem geri alınamaz!'});
    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('sablon_onayla').setLabel('✅ Evet, Kur').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('sablon_iptal').setLabel('❌ İptal').setStyle(ButtonStyle.Secondary),
    );
    await i.reply({embeds:[embed],components:[row],ephemeral:true});
  }
},

// ─── /sesmute ──────────────────────────────
{ data:new SlashCommandBuilder().setName('sesmute').setDescription('Ses mute yönetimi').setDefaultMemberPermissions(PermissionFlagsBits.MuteMembers)
    .addSubcommand(s=>s.setName('at').setDescription('Kullanıcıyı ses kanalında susturur')
      .addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))
      .addStringOption(o=>o.setName('sebep').setDescription('Sebep (yetkililere bildirilir)').setRequired(true))
      .addStringOption(o=>o.setName('sure').setDescription('Süre: 10m 1h 1d — boş=kalıcı')))
    .addSubcommand(s=>s.setName('ac').setDescription('Kullanıcının ses muteunu açma talebi gönderir')
      .addUserOption(o=>o.setName('kullanici').setDescription('Kullanıcı').setRequired(true))),
  cooldown:3,
  async execute(i,client) {
    const sub=i.options.getSubcommand();
    const guildData=getGuild(i.guildId);
    const modRolId=getNotifRolId(guildData);

    // ── /sesmute at ──
    if (sub==='at') {
      const target=i.options.getMember('kullanici');
      const sebep=i.options.getString('sebep');
      const sureStr=i.options.getString('sure');
      if (!target) return i.reply({embeds:[E.err('Hata','Kullanıcı bulunamadı.')],ephemeral:true});
      if (!target.voice.channel) return i.reply({embeds:[E.err('Hata','Kullanıcı ses kanalında değil.')],ephemeral:true});
      if (!target.manageable) return i.reply({embeds:[E.err('Hata','Bu kullanıcıyı yönetemem.')],ephemeral:true});
      const msVal=sureStr?ms(sureStr):0;

      // Önce yetkililere bildir (onay olmadan direk uygula)
      const notifEmbed=new EmbedBuilder().setColor(0xf39c12).setTitle('⚠️ Ses Mute Uygulandı')
        .setDescription('<@'+target.id+'> ('+target.user.tag+') ses kanalında susturuldu.')
        .addFields(
          {name:'👤 Kullanıcı',value:'<@'+target.id+'>',inline:true},
          {name:'👮 Uygulayan',value:'<@'+i.user.id+'>',inline:true},
          {name:'📋 Sebep',value:sebep},
          {name:'⏱ Süre',value:sureStr||'Kalıcı',inline:true},
        ).setTimestamp();
      if (modRolId) {
        const modRol=i.guild.roles.cache.get(modRolId);
        if (modRol) for (const [,m] of modRol.members) {
          if (m.user.bot) continue;
          await m.user.send({embeds:[notifEmbed]}).catch(()=>{});
        }
      }

      // Mute uygula
      await target.voice.setMute(true, sebep);

      // DB'ye kaydet (sag-click koruma için)
      if (!db.data.sesMutes) db.data.sesMutes={};
      const muteKey=i.guildId+'_'+target.id;
      db.data.sesMutes[muteKey]={
        guildId:i.guildId, userId:target.id, modId:i.user.id,
        reason:sebep, duration:sureStr||null, msVal:msVal||0,
        mutedAt:Date.now(), active:true
      };
      getUser(target.id,i.guildId).punishments.push({type:'sesmute',reason:sebep,duration:sureStr||'kalici',mod:i.user.id,timestamp:Date.now()});
      saveDB();

      // Kullanıcıya DM
      await target.user.send({embeds:[new EmbedBuilder().setColor(0xe74c3c).setTitle('🔇 Ses Kanalında Susturuldunuz')
        .setDescription('**'+i.guild.name+'** sunucusunda ses susturması uygulandı.')
        .addFields(
          {name:'📋 Sebep',value:sebep},
          {name:'⏱ Süre',value:sureStr||'Kalıcı (yetkili onayı gerekli)'},
          {name:'👮 Yetkili',value:i.user.tag},
          {name:'ℹ️ Açılması için',value:'`/sesmute ac` komutunu kullanan kişi yetkili onayına gönderir'},
        )
        .setThumbnail(i.guild.iconURL()).setTimestamp()]}).catch(()=>{});

      await i.reply({embeds:[E.ok('Ses Mute Uygulandı',
        '<@'+target.id+'> ses kanalında susturuldu.\n**Sebep:** '+sebep+'\n**Süre:** '+(sureStr||'Kalıcı')
      )]});
      addLog({type:'sesmute',guildId:i.guildId,targetId:target.id,modId:i.user.id,reason:sebep,duration:sureStr});

      // Süreli mute -> otomatik aç
      if (msVal>0) {
        setTimeout(async()=>{
          const fresh=await i.guild.members.fetch(target.id).catch(()=>null);
          if (fresh&&fresh.voice.channel) {
            await fresh.voice.setMute(false,'Ses mute süresi doldu').catch(()=>{});
            if (db.data.sesMutes) { const mk=i.guildId+'_'+target.id; if(db.data.sesMutes[mk]) db.data.sesMutes[mk].active=false; saveDB(); }
            await fresh.user.send({embeds:[E.ok('Ses Mute Sona Erdi','**'+i.guild.name+'** sunucusundaki ses susturman sona erdi.')]}).catch(()=>{});
            addLog({type:'sesmute_bitti',guildId:i.guildId,targetId:target.id,reason:'Sure doldu'});
          }
        }, msVal);
      }
    }

    // ── /sesmute ac ── (talep gönder, yetkili onayı gerekli)
    if (sub==='ac') {
      const target=i.options.getMember('kullanici');
      if (!target) return i.reply({embeds:[E.err('Hata','Kullanıcı bulunamadı.')],ephemeral:true});

      // Aktif ses mute var mı kontrol et
      if (!db.data.sesMutes) db.data.sesMutes={};
      const muteKey=i.guildId+'_'+target.id;
      const muteData=db.data.sesMutes[muteKey];
      if (!muteData||!muteData.active) {
        return i.reply({embeds:[E.err('Hata','Bu kullanıcının aktif ses mutesi bulunamadı.')],ephemeral:true});
      }

      const elapsed=Math.floor((Date.now()-muteData.mutedAt)/60000);
      const embed=new EmbedBuilder().setColor(0xf39c12).setTitle('🔓 Ses Mute Açılma Talebi')
        .setDescription('<@'+target.id+'> kullanıcısının ses mutesinin açılması talep edildi.')
        .addFields(
          {name:'👤 Kullanıcı',value:'<@'+target.id+'> ('+target.user.tag+')',inline:true},
          {name:'📋 Mute Sebebi',value:muteData.reason,inline:true},
          {name:'👮 Mute Uygulayan',value:'<@'+muteData.modId+'>',inline:true},
          {name:'⏱ Uygulanan Süre',value:muteData.duration||'Kalıcı',inline:true},
          {name:'⏳ Geçen Süre',value:elapsed+' dakika',inline:true},
          {name:'📤 Talep Eden',value:'<@'+i.user.id+'>',inline:true},
        ).setTimestamp();
      const row=new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('sesmute_onayla_'+i.guildId+'_'+target.id).setLabel('✅ Onaylıyorum, Aç').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('sesmute_reddet_'+i.guildId+'_'+target.id).setLabel('❌ Reddet').setStyle(ButtonStyle.Danger),
      );

      // Yetkililere talep gönder
      let sent=0;
      if (modRolId) {
        const modRol=i.guild.roles.cache.get(modRolId);
        if (modRol) for (const [,m] of modRol.members) {
          if (m.user.bot) continue;
          await m.user.send({embeds:[embed],components:[row]}).catch(()=>{});
          sent++;
        }
      }
      // Log kanalına da gönder
      const logCh=i.guild.channels.cache.get(guildData.channels.log);
      if (logCh) await logCh.send({embeds:[embed],components:[row]}).catch(()=>{});

      await i.reply({embeds:[E.ok('Talep Gönderildi',
        '**'+sent+'** yetkili DM olarak bilgilendirildi.\nYetkili onaylarsa ses muten açılacak.'
      )],ephemeral:true});
    }
  }
},

// ─── /bj (blackjack) ───────────────────────
{ data:new SlashCommandBuilder().setName('bj').setDescription('BlackJack oyna! Kazan 1.5x, kaybet hepsini')
    .addIntegerOption(o=>o.setName('bahis').setDescription('Bahis miktarı (coin)').setRequired(true).setMinValue(10)),
  cooldown:10,
  async execute(i) {
    const bahis = i.options.getInteger('bahis');
    const ud    = getUser(i.user.id, i.guildId);
    if ((ud.coin||0) < bahis) return i.reply({embeds:[E.err('Yetersiz Coin','Yeterli coinin yok! Bakiyen: **'+(ud.coin||0)+'** coin')],ephemeral:true});

    // Kart yardımcıları
    const SUITS  = ['♠️','♥️','♦️','♣️'];
    const VALUES = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
    const newDeck = () => {
      const d = [];
      for (const s of SUITS) for (const v of VALUES) d.push({s,v});
      for (let i=d.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[d[i],d[j]]=[d[j],d[i]];}
      return d;
    };
    const cardVal = (c) => {
      if (['J','Q','K'].includes(c.v)) return 10;
      if (c.v==='A') return 11;
      return parseInt(c.v);
    };
    const handVal = (hand) => {
      let total=0, aces=0;
      for (const c of hand){total+=cardVal(c); if(c.v==='A')aces++;}
      while (total>21&&aces>0){total-=10;aces--;}
      return total;
    };
    const cardStr = (c) => c.v+c.s;
    const handStr = (hand,hide=false) => hide ? cardStr(hand[0])+' 🂠' : hand.map(cardStr).join(' ');

    const deck   = newDeck();
    const player = [deck.pop(), deck.pop()];
    const dealer = [deck.pop(), deck.pop()];

    // Aktif oyunları sakla
    if (!client.bjGames) client.bjGames = new Map();
    const gameId = i.user.id + '_' + i.guildId;
    client.bjGames.set(gameId, {deck, player, dealer, bahis, userId:i.user.id, guildId:i.guildId});

    const makeEmbed = (status='playing') => {
      const pVal = handVal(player);
      const dVal = status==='playing' ? cardVal(dealer[0]) : handVal(dealer);
      const color = status==='win'?0x22d3a0 : status==='lose'?0xf87171 : status==='push'?0xfbbf24 : 0x5865F2;
      return new EmbedBuilder()
        .setColor(color)
        .setTitle('🃏 BlackJack')
        .setDescription(bjDesc(status, bahis))
        .addFields(
          {name:'👤 Senin Elin ('+pVal+')', value:handStr(player)},
          {name:'🏦 Krupiye Eli ('+(status==='playing'?cardVal(dealer[0])+'?':dVal)+')', value:handStr(dealer, status==='playing')},
        )
        .setFooter({text:'Bakiye: '+(ud.coin||0)+' coin'});
    };

    const pVal = handVal(player);

    // Anında blackjack kontrolü
    if (pVal===21) {
      const kazanc = Math.floor(bahis*1.5);
      ud.coin = (ud.coin||0) + kazanc; saveDB();
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bj_done').setLabel('💰 +'+kazanc+' coin aldın!').setStyle(ButtonStyle.Success).setDisabled(true)
      );
      return i.reply({embeds:[makeEmbed('bj')], components:[row]});
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('bj_hit_'+gameId).setLabel('👆 Çek (Hit)').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('bj_stand_'+gameId).setLabel('✋ Dur (Stand)').setStyle(ButtonStyle.Secondary),
    );

    // Coini kilitle (oyun bitince iade veya düş)
    ud.coin = (ud.coin||0) - bahis; saveDB();
    await i.reply({embeds:[makeEmbed('playing')], components:[row]});
  }
},

// ─── /rolperm ──────────────────────────────
{ data:new SlashCommandBuilder().setName('rolperm').setDescription('Rol bazli bot izin yonetimi').setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(s=>s.setName('ver').setDescription('Role izin ver')
      .addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true))
      .addStringOption(o=>o.setName('izin').setDescription('Izin kodu').setRequired(true).addChoices(
        ...Object.entries(PERMS_DEF).map(([k,v])=>({name:v.label+' ('+k+')',value:k}))
      )))
    .addSubcommand(s=>s.setName('al').setDescription('Rolden izin al')
      .addRoleOption(o=>o.setName('rol').setDescription('Rol').setRequired(true))
      .addStringOption(o=>o.setName('izin').setDescription('Izin kodu').setRequired(true).addChoices(
        ...Object.entries(PERMS_DEF).map(([k,v])=>({name:v.label+' ('+k+')',value:k}))
      )))
    .addSubcommand(s=>s.setName('liste').setDescription('Rol izinlerini listele')
      .addRoleOption(o=>o.setName('rol').setDescription('Rol (bos=tum roller)'))),
  cooldown:3,
  async execute(i) {
    const sub=i.options.getSubcommand();
    const guildData=getGuild(i.guildId);
    if (!guildData.rolPerms) guildData.rolPerms={};

    if (sub==='ver'||sub==='al') {
      const rol=i.options.getRole('rol');
      const izin=i.options.getString('izin');
      if (!guildData.rolPerms[rol.id]) guildData.rolPerms[rol.id]={};
      guildData.rolPerms[rol.id][izin] = (sub==='ver');
      saveDB();
      const pdef=PERMS_DEF[izin];
      // Log
      const logCh2=i.guild.channels.cache.get(guildData.channels.log||guildData.channels.yetkiliLog);
      if (logCh2) logCh2.send({embeds:[new EmbedBuilder()
        .setColor(sub==='ver'?0x22d3a0:0xf87171)
        .setTitle(sub==='ver'?'Yetki Verildi':'Yetki Alindi')
        .addFields(
          {name:'Rol',value:'<@&'+rol.id+'> ('+rol.name+')',inline:true},
          {name:'Izin',value:pdef.label,inline:true},
          {name:'Islem',value:sub==='ver'?'Verildi':'Alindi',inline:true},
          {name:'Yetkili',value:'<@'+i.user.id+'>',inline:true},
        ).setTimestamp()
      ]}).catch(()=>{});
      addLog({type:'rolperm_'+(sub==='ver'?'ver':'al'),guildId:i.guildId,targetId:rol.id,modId:i.user.id,reason:pdef.label});
      return i.reply({embeds:[E.ok(
        sub==='ver'?'Izin Verildi':'Izin Alindi',
        '<@&'+rol.id+'> rolune **'+pdef.label+'** izni '+(sub==='ver'?'verildi':'alindi')+'.'
      )],ephemeral:true});
    }

    if (sub==='liste') {
      const rol=i.options.getRole('rol');
      const entries=rol
        ? [{id:rol.id,name:rol.name,perms:guildData.rolPerms[rol.id]||{}}]
        : Object.entries(guildData.rolPerms).map(([id,perms])=>{
            const r=i.guild.roles.cache.get(id);
            return {id,name:r?r.name:'Bilinmiyor',perms};
          }).filter(e=>Object.keys(e.perms).length>0);

      if (!entries.length) return i.reply({embeds:[E.info('Izin Listesi','Henuz rol izni tanimlanmamis.')],ephemeral:true});

      const cats={Moderasyon:[],Yonetim:[],Eglence:[],Bilgi:[],Admin:[]};
      const embed=new EmbedBuilder().setColor(0x5865F2).setTitle('🔑 Rol Izin Listesi').setTimestamp();

      for (const entry of entries.slice(0,10)) {
        const lines=[];
        for (const [k,v] of Object.entries(PERMS_DEF)) {
          const has=entry.perms[k]===true;
          lines.push((has?'✅':'❌')+' '+v.label);
        }
        embed.addFields({name:'@'+entry.name,value:lines.join('\n')||'Yok',inline:true});
      }
      return i.reply({embeds:[embed],ephemeral:true});
    }
  }
},


// ─── /slot ─────────────────────────────────
{ data:new SlashCommandBuilder().setName('slot').setDescription('Slot makinesi! 3 sembol tut, kazan!')
    .addIntegerOption(o=>o.setName('bahis').setDescription('Bahis miktarı (coin)').setRequired(true).setMinValue(10)),
  cooldown:8,
  async execute(i) {
    const bahis=i.options.getInteger('bahis');
    const ud=getUser(i.user.id,i.guildId);
    if((ud.coin||0)<bahis) return i.reply({embeds:[E.err('Yetersiz Coin','Bakiyen: **'+(ud.coin||0)+'** coin')],ephemeral:true});

    const SEMBOLLER=['🍒','🍋','🍊','🍇','💎','⭐','🔔','7️⃣'];
    const ORANLAR={'🍒':2,'🍋':2.5,'🍊':3,'🍇':3.5,'💎':5,'⭐':6,'🔔':8,'7️⃣':10};
    const spin=()=>SEMBOLLER[Math.floor(Math.random()*SEMBOLLER.length)];

    const s1=spin(),s2=spin(),s3=spin();
    let carpan=0, sonuc='';

    if(s1===s2&&s2===s3){
      carpan=ORANLAR[s1];
      sonuc=`**3x ${s1} JACKPOT!** ${carpan}x kazandın!`;
    } else if(s1===s2||s2===s3||s1===s3){
      carpan=0.5;
      sonuc='2 eşleşme — Yarısı geri!';
    } else {
      sonuc='Eşleşme yok — Kaybettin!';
    }

    const kazanc=Math.floor(bahis*carpan);
    if(carpan>0){ud.coin=(ud.coin||0)-bahis+kazanc;}
    else{ud.coin=(ud.coin||0)-bahis;}
    saveDB();

    const color=carpan>=5?0xFFD700:carpan>0?0x22d3a0:0xf87171;
    await i.reply({embeds:[new EmbedBuilder()
      .setColor(color)
      .setTitle('🎰 Slot Makinesi')
      .setDescription('╔══════════════╗\n║ '+s1+' │ '+s2+' │ '+s3+' ║\n╚══════════════╝\n\n'+sonuc)
      .addFields(
        {name:'Bahis',value:bahis+' coin',inline:true},
        {name:'Sonuç',value:carpan>0?'+'+kazanc+' coin':'-'+bahis+' coin',inline:true},
        {name:'Bakiye',value:(ud.coin||0)+' coin',inline:true},
      ).setFooter({text:'Carpan: '+carpan+'x'})
    ]});
  }
},

// ─── /zar ──────────────────────────────────
{ data:new SlashCommandBuilder().setName('zar').setDescription('Zar at, yüksek çıkarsan kazan!')
    .addIntegerOption(o=>o.setName('bahis').setDescription('Bahis miktarı').setRequired(true).setMinValue(5))
    .addIntegerOption(o=>o.setName('sayi').setDescription('Tahmin (1-6, boş=yüksek/düşük)').setMinValue(1).setMaxValue(6)),
  cooldown:5,
  async execute(i) {
    const bahis=i.options.getInteger('bahis');
    const tahmin=i.options.getInteger('sayi');
    const ud=getUser(i.user.id,i.guildId);
    if((ud.coin||0)<bahis) return i.reply({embeds:[E.err('Yetersiz Coin','Bakiyen: **'+(ud.coin||0)+'** coin')],ephemeral:true});

    const botZar=Math.ceil(Math.random()*6);
    const oyuncuZar=Math.ceil(Math.random()*6);
    const ZARLAR=['','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣'];

    let kazandi=false, aciklama='';
    if(tahmin){
      kazandi=(oyuncuZar===tahmin);
      aciklama=kazandi?'Tam tahmin! 3x kazandın!':'Yanlış tahmin. Kaybettin!';
    } else {
      kazandi=(oyuncuZar>botZar);
      if(oyuncuZar===botZar){aciklama='Berabere — Bahis iade!'; ud.coin=(ud.coin||0)+0; saveDB();}
      else aciklama=kazandi?'Sen kazandın! 2x!':'Bot kazandı. Kaybettin!';
    }

    const carpan=tahmin?3:2;
    const kazanc=Math.floor(bahis*carpan);
    if(oyuncuZar===botZar&&!tahmin){/* iade */}
    else if(kazandi){ud.coin=(ud.coin||0)-bahis+kazanc;}
    else{ud.coin=(ud.coin||0)-bahis;}
    saveDB();

    const berabere=oyuncuZar===botZar&&!tahmin;
    const color=berabere?0xfbbf24:kazandi?0x22d3a0:0xf87171;
    await i.reply({embeds:[new EmbedBuilder()
      .setColor(color).setTitle('🎲 Zar Oyunu')
      .setDescription('**Sen:** '+ZARLAR[oyuncuZar]+(tahmin?' (Tahminin: '+ZARLAR[tahmin]+')':'')+'\n**Bot:** '+ZARLAR[botZar]+'\n\n'+aciklama)
      .addFields(
        {name:'Bahis',value:bahis+' coin',inline:true},
        {name:'Sonuç',value:berabere?'Berabere':kazandi?'+'+kazanc+' coin':'-'+bahis+' coin',inline:true},
        {name:'Bakiye',value:(ud.coin||0)+' coin',inline:true},
      )
    ]});
  }
},

// ─── /rulet ────────────────────────────────
{ data:new SlashCommandBuilder().setName('rulet').setDescription('Rulet çevir!')
    .addIntegerOption(o=>o.setName('bahis').setDescription('Bahis').setRequired(true).setMinValue(10))
    .addStringOption(o=>o.setName('secim').setDescription('Bahis türü').setRequired(true)
      .addChoices(
        {name:'Kirmizi (2x)',value:'kirmizi'},
        {name:'Siyah (2x)',value:'siyah'},
        {name:'Tek (2x)',value:'tek'},
        {name:'Cift (2x)',value:'cift'},
        {name:'1-18 (2x)',value:'kucuk'},
        {name:'19-36 (2x)',value:'buyuk'},
        {name:'Tam Sayi (36x)',value:'sayi'},
      ))
    .addIntegerOption(o=>o.setName('sayi').setDescription('Tam sayı seçtiysen hangi sayı (0-36)').setMinValue(0).setMaxValue(36)),
  cooldown:6,
  async execute(i) {
    const bahis=i.options.getInteger('bahis');
    const secim=i.options.getString('secim');
    const sayiOpt=i.options.getInteger('sayi');
    const ud=getUser(i.user.id,i.guildId);
    if((ud.coin||0)<bahis) return i.reply({embeds:[E.err('Yetersiz Coin','Bakiyen: **'+(ud.coin||0)+'** coin')],ephemeral:true});

    const KIRMIZILAR=[1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36];
    const sonuc=Math.floor(Math.random()*37); // 0-36
    const renk=sonuc===0?'Yeşil':KIRMIZILAR.includes(sonuc)?'Kırmızı':'Siyah';
    const RENK_EMOJI={Kırmızı:'🔴',Siyah:'⚫',Yeşil:'🟢'};

    let kazandi=false;
    if(secim==='kirmizi')      kazandi=renk==='Kırmızı';
    else if(secim==='siyah')   kazandi=renk==='Siyah';
    else if(secim==='tek')     kazandi=sonuc>0&&sonuc%2!==0;
    else if(secim==='cift')    kazandi=sonuc>0&&sonuc%2===0;
    else if(secim==='kucuk')   kazandi=sonuc>=1&&sonuc<=18;
    else if(secim==='buyuk')   kazandi=sonuc>=19&&sonuc<=36;
    else if(secim==='sayi')    kazandi=sayiOpt!==null&&sonuc===sayiOpt;

    const carpan=secim==='sayi'?36:2;
    const kazanc=Math.floor(bahis*carpan);
    if(kazandi){ud.coin=(ud.coin||0)-bahis+kazanc;}
    else{ud.coin=(ud.coin||0)-bahis;}
    saveDB();

    await i.reply({embeds:[new EmbedBuilder()
      .setColor(kazandi?0x22d3a0:0xf87171)
      .setTitle('🎡 Rulet')
      .setDescription(RENK_EMOJI[renk]+' **'+sonuc+'** ('+renk+')\n\n'+(kazandi?'Kazandın! '+carpan+'x':'Kaybettin!'))
      .addFields(
        {name:'Seciminiz',value:secim+(secim==='sayi'?' ('+sayiOpt+')':''),inline:true},
        {name:'Sonuç',value:kazandi?'+'+kazanc+' coin':'-'+bahis+' coin',inline:true},
        {name:'Bakiye',value:(ud.coin||0)+' coin',inline:true},
      )
    ]});
  }
},

// ─── /tahmin ───────────────────────────────
{ data:new SlashCommandBuilder().setName('tahmin').setDescription('Yüksek mi düşük mü? Sayıyı tahmin et!')
    .addIntegerOption(o=>o.setName('bahis').setDescription('Bahis').setRequired(true).setMinValue(5))
    .addStringOption(o=>o.setName('secim').setDescription('Tahminin').setRequired(true)
      .addChoices({name:'Yüksek (51-100)',value:'yuksek'},{name:'Düşük (1-50)',value:'dusuk'})),
  cooldown:5,
  async execute(i) {
    const bahis=i.options.getInteger('bahis');
    const secim=i.options.getString('secim');
    const ud=getUser(i.user.id,i.guildId);
    if((ud.coin||0)<bahis) return i.reply({embeds:[E.err('Yetersiz Coin','Bakiyen: **'+(ud.coin||0)+'** coin')],ephemeral:true});

    const sayi=Math.floor(Math.random()*100)+1;
    const kazandi=(secim==='yuksek'&&sayi>50)||(secim==='dusuk'&&sayi<=50);
    const kazanc=Math.floor(bahis*1.9);
    if(kazandi){ud.coin=(ud.coin||0)-bahis+kazanc;}
    else{ud.coin=(ud.coin||0)-bahis;}
    saveDB();

    await i.reply({embeds:[new EmbedBuilder()
      .setColor(kazandi?0x22d3a0:0xf87171)
      .setTitle('🔢 Tahmin Oyunu')
      .setDescription('Sayı: **'+sayi+'** '+(sayi>50?'(Yüksek)':'(Düşük)')+'\nTahminin: **'+(secim==='yuksek'?'Yüksek':'Düşük')+'**\n\n'+(kazandi?'Kazandın! +'+kazanc+' coin':'Kaybettin! -'+bahis+' coin'))
      .addFields({name:'Bakiye',value:(ud.coin||0)+' coin',inline:true})
    ]});
  }
},

// ─── /kargo ────────────────────────────────
{ data:new SlashCommandBuilder().setName('kargo').setDescription('Coinlerini karşı kişiyle bahse gir!')
    .addUserOption(o=>o.setName('rakip').setDescription('Karşı oyuncu').setRequired(true))
    .addIntegerOption(o=>o.setName('bahis').setDescription('Bahis miktarı').setRequired(true).setMinValue(10)),
  cooldown:15,
  async execute(i) {
    const rakip=i.options.getMember('rakip');
    const bahis=i.options.getInteger('bahis');
    if(!rakip||rakip.user.bot||rakip.id===i.user.id)
      return i.reply({embeds:[E.err('Hata','Geçerli bir rakip seç!')],ephemeral:true});

    const ud1=getUser(i.user.id,i.guildId);
    const ud2=getUser(rakip.id,i.guildId);
    if((ud1.coin||0)<bahis) return i.reply({embeds:[E.err('Yetersiz Coin','Bakiyen: **'+(ud1.coin||0)+'** coin')],ephemeral:true});

    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('kargo_kabul_'+i.user.id+'_'+rakip.id+'_'+bahis).setLabel('✅ Kabul Et').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('kargo_red_'+i.user.id).setLabel('❌ Reddet').setStyle(ButtonStyle.Danger),
    );
    await i.reply({embeds:[new EmbedBuilder()
      .setColor(0x5865F2).setTitle('🤝 Kargo Bahsi')
      .setDescription('<@'+rakip.id+'> seni **'+bahis+' coin** bahse davet ediyor!\nKabul eder misin?')
      .setFooter({text:'30 saniye içinde cevap ver'})
    ],components:[row]});
    setTimeout(async()=>{
      try{await i.editReply({components:[]});}catch{}
    },30000);
  }
},

// ─── /gunluk ───────────────────────────────
{ data:new SlashCommandBuilder().setName('gunluk').setDescription('Günlük coin ödülünü al!'), cooldown:3,
  async execute(i) {
    const ud=getUser(i.user.id,i.guildId);
    const now=Date.now();
    const last=ud.daily?.lastClaim||0;
    const COOLDOWN=20*60*60*1000; // 20 saat
    if(now-last<COOLDOWN){
      const kalan=Math.ceil((COOLDOWN-(now-last))/3600000);
      return i.reply({embeds:[E.warn('Çok Erken','Tekrar almak için **'+kalan+' saat** beklemelisin!')],ephemeral:true});
    }
    const DAILY=Number(process.env.DAILY_COIN)||100;
    const bonus=Math.floor(Math.random()*50); // 0-50 bonus
    const toplam=DAILY+bonus;
    ud.coin=(ud.coin||0)+toplam;
    ud.totalCoin=(ud.totalCoin||0)+toplam;
    ud.daily=ud.daily||{};
    ud.daily.lastClaim=now;
    ud.daily.streak=(ud.daily.streak||0)+1;
    saveDB();
    await i.reply({embeds:[new EmbedBuilder()
      .setColor(0xFFD700).setTitle('🎁 Günlük Ödül')
      .setDescription('**+'+toplam+' coin** aldın!'+(bonus>0?' ('+bonus+' bonus!)':''))
      .addFields(
        {name:'Bakiye',value:(ud.coin||0)+' coin',inline:true},
        {name:'Streak',value:(ud.daily.streak||1)+' gün',inline:true},
      ).setTimestamp()
    ]});
  }
},

// ─── /ping ─────────────────────────────────
{ data:new SlashCommandBuilder().setName('ping').setDescription('Bot gecikmesi'), cooldown:5,
  async execute(i,client) { await i.reply({embeds:[E.info('🏓 Pong!','**Bot:** '+client.ws.ping+'ms\n**API:** '+(Date.now()-i.createdTimestamp)+'ms')]}); }
},

// ─── /yardim ───────────────────────────────
{ data:new SlashCommandBuilder().setName('yardim').setDescription('Komut listesi'), cooldown:10,
  async execute(i) {
    await i.reply({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('⚡ Prox Bot — Komutlar').setThumbnail(i.client.user.displayAvatarURL())
      .addFields(
        {name:'⚔️ Moderasyon',value:'`/ban` `/unban` `/kick` `/mute` `/unmute` `/uyar` `/cezalar` `/temizle`'},
        {name:'📋 Kayıt',value:'`/kayit`'},
        {name:'⚙️ Kurulum',value:'`/setup` `/ticketsetup` `/sistem`'},
        {name:'📊 İstatistik',value:'`/stats` `/coin` `/davet` `/sunucu` `/kullanici`'},
        {name:'🎫 Ticket',value:'`/ticketsetup gonder` — Ticket panelini gönder'},
        {name:'🔊 Ses',value:'`/ses toplanti-ac` `/ses duyuru` `/sesmute` `/ses toplanti-kapat`'},
        {name:'🎉 Çekiliş',value:'`/cekilis`'},
        {name:'🚫 Blacklist',value:'`/blacklist` `/blacklistkontrol`'},
        {name:'📋 Yetkili Başvuru',value:'`/yetkilibasvuru`'},
        {name:'🔧 Yardımcı',value:'`/rol` `/yavaslat` `/kilit` `/sablon` `/ping` `/yardim`'},
      ).setFooter({text:'Prox Bot • '+i.client.guilds.cache.size+' sunucu'}).setTimestamp()],ephemeral:true});
  }
},

];

// =============================================
//   CLIENT
// =============================================
const client=new Client({
  intents:[
    GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions,GatewayIntentBits.GuildInvites,
    GatewayIntentBits.DirectMessages,
  ],
  partials:[Partials.Message,Partials.Channel,Partials.Reaction,Partials.User,Partials.GuildMember],
});
client.cooldowns=new Collection();
client.voiceMap=new Collection();
client.spamMap=new Collection();
client.inviteCache=new Collection();

// ─── Deploy ────────────────────────────────
async function deployCommands() {
  try {
    const rest=new REST().setToken(process.env.DISCORD_TOKEN);
    const body=commands.map(c=>c.data.toJSON());
    console.log(chalk.cyan('  ⚡ '+body.length+' komut kaydediliyor...'));
    for (const [gid] of client.guilds.cache) {
      await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID,gid),{body}).catch(e=>console.error(chalk.red('  Guild ['+gid+']:'),e.message));
    }
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID),{body});
    console.log(chalk.green('  ✅ '+body.length+' komut kaydedildi!'));
  } catch(e) { console.error(chalk.red('  ❌ Deploy:'),e.message); }
}

// =============================================
//   EVENTLER
// =============================================
client.once('ready', async()=>{
  console.log(chalk.magenta('\n  🤖  '+client.user.tag+' — Hazır!'));
  console.log(chalk.gray('  📊  '+client.guilds.cache.size+' sunucu\n'));
  await deployCommands();
  client.user.setPresence({activities:[{name:'/yardim | Prox Bot',type:ActivityType.Watching}],status:'online'});
  for (const guild of client.guilds.cache.values()) {
    try{const invs=await guild.invites.fetch(); client.inviteCache.set(guild.id,new Map(invs.map(i=>[i.code,i.uses])));}catch{}
  }
  for (const [id,g] of Object.entries(db.data.giveaways)) {
    if (g.ended) continue;
    const left=g.endsAt-Date.now(); const ch=client.channels.cache.get(g.channelId); if (!ch) continue;
    if (left<=0) endGiveaway(id,ch); else setTimeout(()=>endGiveaway(id,ch),left);
  }
});

client.on('interactionCreate', async interaction=>{
  // Slash
  if (interaction.isChatInputCommand()) {
    const cmd=commands.find(c=>c.data.name===interaction.commandName); if (!cmd) return;
    if (!client.cooldowns.has(cmd.data.name)) client.cooldowns.set(cmd.data.name,new Collection());
    const ts=client.cooldowns.get(cmd.data.name); const now=Date.now(); const cd=(cmd.cooldown||3)*1000;
    if (ts.has(interaction.user.id)&&now<ts.get(interaction.user.id)+cd) {
      const left=((ts.get(interaction.user.id)+cd-now)/1000).toFixed(1);
      return interaction.reply({embeds:[E.err('Cooldown','**'+left+'s** bekle.')],ephemeral:true});
    }
    ts.set(interaction.user.id,now); setTimeout(()=>ts.delete(interaction.user.id),cd);
    if (interaction.guildId){const u=getUser(interaction.user.id,interaction.guildId); u.stats.commands++; saveDB();}
    try { await cmd.execute(interaction,client); }
    catch(err) {
      console.error(chalk.red('[Komut Hata] /'+interaction.commandName+':'),err);
      const p={embeds:[E.err('Hata','Bir şeyler ters gitti.')],ephemeral:true};
      interaction.replied||interaction.deferred?await interaction.followUp(p):await interaction.reply(p);
    }
    return;
  }

  // Select Menu
  if (interaction.isStringSelectMenu()&&interaction.customId==='ticket_kategori') {
    const guild=getGuild(interaction.guildId);
    if (!guild.systems.ticket) return interaction.reply({content:'❌ Ticket sistemi kapalı. `/sistem ticket true` komutu ile açabilirsin.',ephemeral:true});
    const kMap={genel:'📋 Genel Destek',ban_itiraz:'🔨 Ban/Ceza İtirazı',satin_alim:'💰 Satın Alım',sikayet:'🛡️ Şikayet',diger:'📝 Diğer'};
    const kategori=kMap[interaction.values[0]]||'Genel';
    // deferUpdate: menüyü "işlendi" olarak işaretle, spinner gösterme
    try { await interaction.deferUpdate(); } catch {}
    await createTicketChannel(interaction,guild,kategori);
    return;
  }

  // Butonlar
  if (interaction.isButton()) {
    const {customId}=interaction;

    // ── Kargo bahis butonları ──────────────────────────────────
    if (customId.startsWith('kargo_kabul_') || customId.startsWith('kargo_red_')) {
      const parts = customId.split('_');
      if (customId.startsWith('kargo_red_')) {
        const davetciId = parts[2];
        return interaction.update({embeds:[E.warn('Reddedildi','Bahis teklifi reddedildi.')],components:[]});
      }
      // kargo_kabul_{davetciId}_{rakipId}_{bahis}
      const davetciId = parts[2], rakipId = parts[3], bahis = parseInt(parts[4]);
      if (interaction.user.id !== rakipId)
        return interaction.reply({content:'Bu davet sana değil!',ephemeral:true});

      const ud1 = getUser(davetciId, interaction.guildId);
      const ud2 = getUser(rakipId,   interaction.guildId);
      if ((ud1.coin||0) < bahis) return interaction.update({embeds:[E.err('Yetersiz Coin','Davetçinin coini yetersiz!')],components:[]});
      if ((ud2.coin||0) < bahis) return interaction.update({embeds:[E.err('Yetersiz Coin','Senin coinin yetersiz!')],components:[]});

      const kazanan = Math.random()<0.5 ? davetciId : rakipId;
      const kaybeden = kazanan===davetciId ? rakipId : davetciId;
      getUser(kazanan, interaction.guildId).coin = (getUser(kazanan,interaction.guildId).coin||0) + bahis;
      getUser(kaybeden,interaction.guildId).coin = (getUser(kaybeden,interaction.guildId).coin||0) - bahis;
      saveDB();
      return interaction.update({embeds:[new EmbedBuilder()
        .setColor(0x22d3a0).setTitle('🤝 Kargo Bahis Sonucu')
        .setDescription('<@'+kazanan+'> kazandi! **+'+bahis+' coin**\n<@'+kaybeden+'> kaybetti. **-'+bahis+' coin**')
      ],components:[]});
    }

    // ── BlackJack butonları ─────────────────────────────────────
    if (customId.startsWith('bj_hit_') || customId.startsWith('bj_stand_')) {
      const gameId = customId.replace('bj_hit_','').replace('bj_stand_','');
      if (!client.bjGames) client.bjGames = new Map();
      const game = client.bjGames.get(gameId);

      if (!game) return interaction.reply({content:'❌ Oyun bulunamadı. Yeni oyun için `/bj` kullan.',ephemeral:true});
      if (game.userId !== interaction.user.id) return interaction.reply({content:'❌ Bu senin oyunun değil!',ephemeral:true});

      const {deck,player,dealer,bahis} = game;
      const cardVal = (c) => {if(['J','Q','K'].includes(c.v))return 10;if(c.v==='A')return 11;return parseInt(c.v);};
      const handVal = (hand) => {let t=0,a=0;for(const c of hand){t+=cardVal(c);if(c.v==='A')a++;}while(t>21&&a>0){t-=10;a--;}return t;};
      const cardStr = (c) => c.v+c.s;
      const handStr = (hand,hide=false) => hide ? cardStr(hand[0])+' 🂠' : hand.map(cardStr).join(' ');

      const ud = getUser(game.userId, game.guildId);
      let status = 'playing';

      if (customId.startsWith('bj_hit_')) {
        player.push(deck.pop());
        const pv = handVal(player);
        if (pv > 21) {
          status = 'bust'; // battı — coin zaten düşülmüştü
          client.bjGames.delete(gameId);
        } else if (pv === 21) {
          // 21 — krupiye oynasın
          status = 'dealer';
        }
      }

      if (customId.startsWith('bj_stand_') || status === 'dealer') {
        // Krupiye 17'ye kadar çeker
        while (handVal(dealer) < 17) dealer.push(deck.pop());
        const pv = handVal(player);
        const dv = handVal(dealer);
        if (dv > 21 || pv > dv)      status = 'win';
        else if (pv === dv)           status = 'push';
        else                          status = 'lose';
        client.bjGames.delete(gameId);
      }

      // Coin hesapla
      if (status === 'win') {
        const kazanc = Math.floor(bahis * 1.5);
        ud.coin = (ud.coin||0) + bahis + kazanc; // bahis geri + kazanç
      } else if (status === 'push') {
        ud.coin = (ud.coin||0) + bahis; // bahis iade
      }
      // bust/lose: coin zaten düşülmüştü, ekleme
      if (status !== 'bust' && status !== 'lose') saveDB();
      else saveDB();

      const color = status==='win'?0x22d3a0 : status==='lose'||status==='bust'?0xf87171 : status==='push'?0xfbbf24 : 0x5865F2;
      const desc  = bjDesc(status, bahis);

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('🃏 BlackJack')
        .setDescription('**Bahis:** '+bahis+' coin\n'+desc)
        .addFields(
          {name:'👤 Senin Elin ('+handVal(player)+')', value:handStr(player)},
          {name:'🏦 Krupiye Eli ('+(status==='playing'?cardVal(dealer[0])+'?':handVal(dealer))+')', value:handStr(dealer, status==='playing')},
        )
        .setFooter({text:'Bakiye: '+(ud.coin||0)+' coin'});

      const gameOver = status !== 'playing';
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('bj_hit_'+gameId).setLabel('👆 Çek (Hit)').setStyle(ButtonStyle.Primary).setDisabled(gameOver),
        new ButtonBuilder().setCustomId('bj_stand_'+gameId).setLabel('✋ Dur (Stand)').setStyle(ButtonStyle.Secondary).setDisabled(gameOver),
      );

      return interaction.update({embeds:[embed], components:[row]});
    }

    if (customId==='ticket_close') {
      const t=db.data.tickets[interaction.channelId];
      if (t){t.closed=true;t.closedAt=Date.now();t.closedBy=interaction.user.id;saveDB();}
      await interaction.reply({content:'🔒 Ticket kapatılıyor, konuşma geçmişi DM olarak gönderiliyor...'});
      try {
        const msgs=await interaction.channel.messages.fetch({limit:100});
        const sorted=[...msgs.values()].sort((a,b)=>a.createdTimestamp-b.createdTimestamp);
        const lines=sorted.filter(m=>m.content&&m.content.trim()).map(m=>'['+new Date(m.createdTimestamp).toLocaleString('tr-TR')+'] '+m.author.tag+': '+m.content).join('\n');
        const owner=await client.users.fetch(t?.userId||interaction.user.id).catch(()=>null);
        if (owner) {
          await owner.send({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('🎫 Ticket Geçmişi — '+interaction.guild.name)
            .addFields({name:'📋 Kategori',value:t?.kategori||'Genel',inline:true},{name:'📅 Açılış',value:t?.openedAt?'<t:'+Math.floor(t.openedAt/1000)+':F>':'—',inline:true},{name:'🔒 Kapanış',value:'<t:'+Math.floor(Date.now()/1000)+':F>',inline:true})
            .setTimestamp()]}).catch(()=>{});
          if (lines) {
            const chunks=lines.match(/[\s\S]{1,1900}/g)||[];
            for (const chunk of chunks.slice(0,8)) await owner.send({content:'```\n'+chunk+'\n```'}).catch(()=>{});
          }
        }
        const gData=getGuild(interaction.guildId);
        const logCh=interaction.guild.channels.cache.get(gData.channels.log);
        if (logCh) logCh.send({embeds:[new EmbedBuilder().setColor(0x95a5a6).setTitle('🔒 Ticket Kapatıldı')
          .addFields({name:'Kullanıcı',value:owner?'<@'+owner.id+'>':t?.userId||'—',inline:true},{name:'Kapatan',value:'<@'+interaction.user.id+'>',inline:true},{name:'Mesaj',value:'`'+sorted.length+'`',inline:true})
          .setTimestamp()]}).catch(()=>{});
      } catch(e){console.error(e);}
      setTimeout(()=>interaction.channel.delete().catch(()=>{}),3000);
      return;
    }

    if (customId==='giveaway_join') {
      const g=db.data.giveaways[interaction.message.id];
      if (!g||g.ended) return interaction.reply({content:'Bu çekiliş sona erdi.',ephemeral:true});
      if (g.participants.includes(interaction.user.id)) return interaction.reply({content:'✅ Zaten katıldın!',ephemeral:true});
      g.participants.push(interaction.user.id); saveDB();
      return interaction.reply({content:'🎉 Katıldın! Toplam: '+g.participants.length,ephemeral:true});
    }

    if (customId==='sablon_onayla') {
      if (interaction.user.id!==interaction.guild.ownerId) return interaction.reply({content:'❌ Sadece sunucu sahibi.',ephemeral:true});
      await interaction.update({embeds:[E.info('⏳ Kuruluyor...','Kanallar ve roller yeniden oluşturuluyor...')],components:[]});
      const ok=await installTemplate(interaction.guild);
      return interaction.followUp({embeds:[ok?E.ok('Şablon Kuruldu!','Prox şablonu başarıyla kuruldu! `/setup` ile ayarları yapabilirsin.'):E.err('Hata','Şablon kurulurken hata oluştu.')],ephemeral:true});
    }
    if (customId==='sablon_iptal') return interaction.update({embeds:[E.warn('İptal','Şablon kurulmadı.')],components:[]});

    if (customId.startsWith('sablon_dm_evet_')) {
      const gid=customId.replace('sablon_dm_evet_','');
      const tg=client.guilds.cache.get(gid); if (!tg) return interaction.reply({content:'❌ Sunucu bulunamadı.',ephemeral:true});
      if (interaction.user.id!==tg.ownerId) return interaction.reply({content:'❌ Sadece sunucu sahibi.',ephemeral:true});
      await interaction.update({embeds:[E.info('⏳ Kuruluyor...','Lütfen bekleyin...')],components:[]});
      const ok=await installTemplate(tg);
      return interaction.followUp({embeds:[ok?E.ok('Şablon Kuruldu!','Başarıyla kuruldu!'):E.err('Hata','Şablon kurulurken hata oluştu.')]});
    }
    if (customId.startsWith('sablon_dm_hayir_')) return interaction.update({embeds:[E.info('Tamam!','/setup ile manuel kurulum yapabilirsin.')],components:[]});

    // ── Ses mute onay/red (DM'den geliyor — interaction.update() çalışmaz!)
    if (customId.startsWith('sesmute_onayla_') || customId.startsWith('sesmute_reddet_')) {
      const parts  = customId.split('_');
      const action = parts[1]; // 'onayla' veya 'reddet'
      const gid    = parts[2];
      const uid    = parts[3];

      // DM'de channel yok, reply kullan (update değil)
      const dmReply = async (opts) => {
        try {
          if (interaction.replied || interaction.deferred) return interaction.editReply(opts);
          return interaction.reply({...opts, ephemeral:false});
        } catch { try { return interaction.followUp(opts); } catch {} }
      };

      const guild = client.guilds?.cache?.get(gid);
      if (!guild) return dmReply({content:'❌ Sunucu bulunamadı.', components:[]});

      if (!db.data.sesMutes) db.data.sesMutes = {};
      const muteKey = gid + '_' + uid;
      const md      = db.data.sesMutes[muteKey];

      if (action === 'reddet') {
        // Butonu devre dışı bırak
        const disabledRow = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('_disabled1').setLabel('✅ Onaylıyorum, Aç').setStyle(ButtonStyle.Success).setDisabled(true),
          new ButtonBuilder().setCustomId('_disabled2').setLabel('❌ Reddedildi').setStyle(ButtonStyle.Danger).setDisabled(true)
        );
        try { await interaction.message.edit({components:[disabledRow]}); } catch {}
        return dmReply({content:'❌ Ses mute açma talebi reddedildi. Reddeden: **' + interaction.user.tag + '**'});
      }

      // ONAYLA
      if (!md || !md.active) {
        try { await interaction.message.edit({components:[]}); } catch {}
        return dmReply({content:'ℹ️ Bu ses mutesi zaten aktif değil.'});
      }

      const member = await guild.members.fetch(uid).catch(() => null);
      if (member && member.voice.channel) {
        await member.voice.setMute(false, 'Yetkili onayı: ' + interaction.user.tag).catch(() => {});
      }
      md.active    = false;
      md.openedBy  = interaction.user.id;
      md.openedAt  = Date.now();
      saveDB();

      // Kullanıcıya DM
      if (member) {
        await member.user.send({embeds:[new EmbedBuilder()
          .setColor(0x22d3a0)
          .setTitle('🔊 Ses Mute Kaldırıldı')
          .setDescription('**' + guild.name + '** sunucusundaki ses susturman kaldırıldı.')
          .addFields(
            {name:'👮 Onaylayan', value: interaction.user.tag, inline: true},
            {name:'📋 Mute Sebebi', value: md.reason || '—', inline: true}
          ).setTimestamp()
        ]}).catch(() => {});
      }

      addLog({type:'sesmute_ac', guildId:gid, targetId:uid, modId:interaction.user.id, reason:'Yetkili onayı'});

      // Log kanalı
      const gData  = getGuild(gid);
      const logCh  = guild.channels.cache.get(gData.channels.log);
      if (logCh) logCh.send({embeds:[E.ok('🔊 Ses Mute Açıldı',
        '<@' + uid + '> ses mutesi **' + interaction.user.tag + '** tarafından onaylanarak kaldırıldı.'
      )]}).catch(() => {});

      // Butonları devre dışı bırak
      const disabledRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('_dis1').setLabel('✅ Onaylandı').setStyle(ButtonStyle.Success).setDisabled(true),
        new ButtonBuilder().setCustomId('_dis2').setLabel('❌ Reddet').setStyle(ButtonStyle.Danger).setDisabled(true)
      );
      try { await interaction.message.edit({components:[disabledRow]}); } catch {}
      return dmReply({content:'✅ Ses mute kaldırıldı! Kullanıcı: <@' + uid + '>'});
    }

    if (customId.startsWith('app_accept_')||customId.startsWith('app_reject_')) {
      const accepted=customId.startsWith('app_accept_'); const targetId=customId.split('_')[2];
      const key=interaction.guildId+'_'+targetId;
      if (db.data.applications[key]) db.data.applications[key].status=accepted?'accepted':'rejected'; saveDB();
      const target=await client.users.fetch(targetId).catch(()=>null);
      if (target) {
        const dmE=accepted
          ?new EmbedBuilder().setColor(0x2ecc71).setTitle('🎉 Başvurun Kabul Edildi!')
            .setDescription('**'+interaction.guild.name+'** sunucusundaki yetkili başvurun **kabul edildi!**')
            .addFields({name:'👮 Değerlendiren',value:interaction.user.tag,inline:true},{name:'📅 Tarih',value:'<t:'+Math.floor(Date.now()/1000)+':F>',inline:true})
            .setThumbnail(interaction.guild.iconURL()).setTimestamp()
          :new EmbedBuilder().setColor(0xe74c3c).setTitle('❌ Başvurun Reddedildi')
            .setDescription('**'+interaction.guild.name+'** sunucusundaki başvurun bu sefer kabul edilmedi.')
            .addFields({name:'👮 Değerlendiren',value:interaction.user.tag,inline:true},{name:'💡 Not',value:'Daha sonra tekrar başvurabilirsin.'})
            .setThumbnail(interaction.guild.iconURL()).setTimestamp();
        await target.send({embeds:[dmE]}).catch(()=>{});
      }
      await interaction.update({components:[]});
      return interaction.followUp({content:(accepted?'✅ Kabul':'❌ Red')+': <@'+targetId+'>',ephemeral:true});
    }
  }

  // Modal - Başvuru
  if (interaction.isModalSubmit()&&interaction.customId==='basvuru_modal') {
    const guild=getGuild(interaction.guildId); const key=interaction.guildId+'_'+interaction.user.id;
    const sorular=guild.basvuruSorular&&guild.basvuruSorular.length>0?guild.basvuruSorular:['Kaç yaşındasın?','Daha önce yetkili oldun mu?','Neden yetkili olmak istiyorsun?','Günlük kaç saat aktif olabilirsin?','Eklemek istediğin bir şey?'];
    const answers={};
    sorular.slice(0,5).forEach((s,idx)=>{try{answers['s'+idx]=interaction.fields.getTextInputValue('s'+idx)||'—';}catch{}});
    db.data.applications[key]={userId:interaction.user.id,guildId:interaction.guildId,status:'pending',answers,sorular,appliedAt:Date.now()}; saveDB();
    const embed=new EmbedBuilder().setColor(0x5865F2).setTitle('📋 Yetkili Başvurusu')
      .setThumbnail(interaction.user.displayAvatarURL())
      .setDescription('**Başvuran:** '+interaction.user+' ('+interaction.user.tag+')\n**Tarih:** <t:'+Math.floor(Date.now()/1000)+':F>')
      .addFields(sorular.slice(0,5).map((s,idx)=>({name:(idx+1)+'. '+s,value:answers['s'+idx]||'—'})))
      .setTimestamp();
    const row=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('app_accept_'+interaction.user.id).setLabel('✅ Kabul').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('app_reject_'+interaction.user.id).setLabel('❌ Red').setStyle(ButtonStyle.Danger),
    );
    // Başvuru kanalına gönder
    const logChId=guild.channels.basvuruKanal||guild.channels.yetkiliLog||guild.channels.log;
    if (logChId){const ch=interaction.guild.channels.cache.get(logChId);if(ch)await ch.send({embeds:[embed],components:[row]});}
    // Başvurana DM
    await interaction.user.send({embeds:[new EmbedBuilder().setColor(0x5865F2).setTitle('📋 Başvurun Alindi!')
      .setDescription('**'+interaction.guild.name+'** sunucusuna yetkili başvurun alindi.\nSonuç DM olarak bildirilecek.')
      .addFields({name:'📅 Başvuru Tarihi',value:'<t:'+Math.floor(Date.now()/1000)+':F>'})
      .setThumbnail(interaction.guild.iconURL()).setTimestamp()]}).catch(()=>{});
    await interaction.reply({embeds:[E.ok('Başvuru Alindi','Başvurun yetkililere iletildi! Sonuç DM ile gelecek.')],ephemeral:true});
  }
});

// ── messageCreate ────────────────────────────
client.on('messageCreate', async message=>{
  if (message.author.bot||!message.guild) return;
  const guild=getGuild(message.guildId); const user=getUser(message.author.id,message.guildId);
  user.stats.messages++; user.stats.dailyMessages++;
  // coin per message kaldirildi
  // Blacklist
  if (guild.systems.blacklist) {
    const content=message.content.toLowerCase();
    const bad=db.data.blacklist.find(b=>b.guildId===message.guildId&&b.type==='word'&&content.includes(b.value));
    if (bad){await message.delete().catch(()=>{}); const w=await message.channel.send({content:'⚠️ <@'+message.author.id+'> yasaklı kelime!'}); setTimeout(()=>w.delete().catch(()=>{}),5000); saveDB(); return;}
  }
  // Anti-spam — 3+ mesaj 5sn içinde -> mesajları sil, 20sn koruma
  if (guild.systems.antiSpam) {
    const spamKey=message.guildId+'_'+message.author.id;
    const now=Date.now();
    if (!client.spamMap.has(spamKey)) client.spamMap.set(spamKey,{count:0,first:now,msgs:[]});
    const entry=client.spamMap.get(spamKey);

    // 5 saniyelik pencere
    if (now-entry.first>5000) { entry.count=1; entry.first=now; entry.msgs=[message.id]; }
    else { entry.count++; entry.msgs.push(message.id); }

    if (entry.count>=3) {
      // Attığı mesajları sil
      const toDelete=[...entry.msgs];
      entry.msgs=[];
      for (const msgId of toDelete) {
        const m=await message.channel.messages.fetch(msgId).catch(()=>null);
        if (m) await m.delete().catch(()=>{});
      }
      // Uyarı mesajı
      const warn=await message.channel.send({content:'⚠️ <@'+message.author.id+'> spam koruması devreye girdi! Mesajların silindi, 20 saniye beklemelisin.'});
      setTimeout(()=>warn.delete().catch(()=>{}),8000);
      // 20 saniye spam koruması — bu süre içinde atılan mesajlar da silinir
      client.spamMap.set(spamKey,{...entry,blocked:true,blockUntil:now+20000});
      setTimeout(()=>{
        const cur=client.spamMap.get(spamKey);
        if (cur) { cur.blocked=false; cur.count=0; cur.blockUntil=0; }
      },20000);
    } else if (entry.blocked && now<entry.blockUntil) {
      // Koruma süresi dolmadı — mesajı sil
      await message.delete().catch(()=>{});
    }
  }
  saveDB();
});

// ── voiceStateUpdate ──────────────────────────
client.on('voiceStateUpdate', async(oldS,newS)=>{
  const member=newS.member||oldS.member; if (!member||member.user.bot||!newS.guild) return;
  const gid=newS.guild.id; const uid=member.id; const key=gid+'_'+uid; const guild=getGuild(gid);

  // Sağ click ile mute kaldırıldıysa ve aktif ses mute varsa tekrar mute et
  if (newS.channel && oldS.serverMute && !newS.serverMute) {
    if (!db.data.sesMutes) db.data.sesMutes={};
    const mk=gid+'_'+uid;
    const md=db.data.sesMutes[mk];
    if (md&&md.active) {
      // Kısa gecikme sonra tekrar mute et
      setTimeout(async()=>{
        const fresh=await newS.guild.members.fetch(uid).catch(()=>null);
        if (fresh&&fresh.voice.channel) {
          await fresh.voice.setMute(true,'Ses mute aktif — yetkili onayı gerekli').catch(()=>{});
          // Kullanıcıya bildir
          await fresh.user.send({embeds:[new EmbedBuilder().setColor(0xe74c3c).setTitle('🔇 Ses Mute Aktif')
            .setDescription('Ses susturman hâlâ aktif. Açılması için `/sesmute ac` komutunu kullanabilirsin.')
            .addFields({name:'📋 Sebep',value:md.reason},{name:'⏱ Süre',value:md.duration||'Kalıcı'})
            .setTimestamp()]}).catch(()=>{});
          // Log
          const gData=getGuild(gid);
          const logCh=newS.guild.channels.cache.get(gData.channels.log);
          if (logCh) logCh.send({embeds:[E.warn('🔇 Ses Mute Tekrarlandı','<@'+uid+'> sağ click ile mute kaldırmaya çalıştı, tekrar mute uygulandı.')]}).catch(()=>{});
        }
      }, 500);
    }
  }

  if (!oldS.channel&&newS.channel) {
    client.voiceMap.set(key,Date.now());
    if (guild.roles.sesRol&&guild.systems.ses) await member.roles.add(guild.roles.sesRol).catch(()=>{});
    const logCh=newS.guild.channels.cache.get(guild.channels.sesLog||guild.channels.log);
    if (logCh) logCh.send({embeds:[new EmbedBuilder().setColor(0x2ecc71).setTitle('🔊 Ses Girişi').setDescription('**'+member.user.tag+'** -> **'+newS.channel.name+'**').setTimestamp()]}).catch(()=>{});
  }
  if (oldS.channel&&!newS.channel) {
    const jt=client.voiceMap.get(key);
    if (jt){const min=Math.floor((Date.now()-jt)/60000); const u=getUser(uid,gid); u.stats.voiceMinutes+=min; u.stats.dailyVoice+=min; if(guild.systems.coin) u.coin=(u.coin||0)+min*(Number(process.env.COIN_PER_VOICE_MIN)||2); saveDB(); client.voiceMap.delete(key);}
    if (guild.roles.sesRol&&guild.systems.ses) await member.roles.remove(guild.roles.sesRol).catch(()=>{});
    const logCh=newS.guild.channels.cache.get(guild.channels.sesLog||guild.channels.log);
    if (logCh) logCh.send({embeds:[new EmbedBuilder().setColor(0xe74c3c).setTitle('🔇 Ses Çıkışı').setDescription('**'+member.user.tag+'** ← **'+oldS.channel.name+'**').setTimestamp()]}).catch(()=>{});
  }
});

// ── guildCreate ───────────────────────────────
client.on('guildCreate', async guild=>{
  console.log(chalk.green('[+] Yeni sunucu: '+guild.name+' ('+guild.id+')'));
  getGuild(guild.id);
  await quickSetup(guild);
});

// ── guildMemberAdd ────────────────────────────
client.on('guildMemberAdd', async member=>{
  if (member.user.bot) return; const guild=getGuild(member.guild.id);
  if (guild.roles.unregistered) await member.roles.add(guild.roles.unregistered).catch(()=>{});
  // Davet takibi
  if (guild.systems.davet) {
    try {
      const newInvs=await member.guild.invites.fetch(); const cached=client.inviteCache.get(member.guild.id)||new Map();
      const used=newInvs.find(i=>(cached.get(i.code)||0)<(i.uses||0));
      if (used?.inviter) {
        const invId=used.inviter.id; const invU=getUser(invId,member.guild.id); invU.stats.invites++;
        if (!db.data.invites) db.data.invites={};
        if (!db.data.invites[member.guild.id]) db.data.invites[member.guild.id]={};
        if (!db.data.invites[member.guild.id][invId]) db.data.invites[member.guild.id][invId]={total:0,members:[]};
        db.data.invites[member.guild.id][invId].total++;
        db.data.invites[member.guild.id][invId].members.push({id:member.id,joinedAt:Date.now()}); saveDB();
        const logCh=member.guild.channels.cache.get(guild.channels.davetLog||guild.channels.log);
        if (logCh) logCh.send({embeds:[new EmbedBuilder().setColor(0x3498db).setTitle('📨 Yeni Üye')
          .setDescription('**'+member.user.tag+'** katıldı!\n**Davet Eden:** <@'+invId+'> (Toplam: '+db.data.invites[member.guild.id][invId].total+')')
          .setThumbnail(member.user.displayAvatarURL()).setTimestamp()]}).catch(()=>{});
      }
      client.inviteCache.set(member.guild.id,new Map(newInvs.map(i=>[i.code,i.uses])));
    } catch {}
  }
  // Blacklist kullanici + sunucu kontrolu
  if (guild.systems.blacklist) {
    const blEntry=db.data.blacklist.find(b=>b.guildId===member.guild.id&&b.type==='user'&&b.value===member.id);
    if (blEntry) {
      if (member.bannable) {
        await member.ban({reason:'Blacklist: '+blEntry.reason,deleteMessageSeconds:0}).catch(()=>{});
        const logCh2=member.guild.channels.cache.get(guild.channels.log);
        if (logCh2) logCh2.send({embeds:[new EmbedBuilder().setColor(0xe74c3c).setTitle('🚫 Blacklist Bani')
          .setDescription('<@'+member.id+'> sunucuya girdi ve blacklist nedeniyle banlandı.')
          .addFields(
            {name:'Kullanici',value:member.user.tag,inline:true},
            {name:'Sebep',value:blEntry.reason,inline:true},
            {name:'Ekleyen',value:blEntry.addedBy?'<@'+blEntry.addedBy+'>':'Bilinmiyor',inline:true}
          ).setTimestamp()]}).catch(()=>{});
      }
    } else {
      await checkBlacklist(member, guild, member.guild);
    }
  }
});

// ── guildMemberRemove ─────────────────────────
client.on('guildMemberRemove', async member=>{
  if (member.user.bot) return; const guild=getGuild(member.guild.id);
  const logCh=member.guild.channels.cache.get(guild.channels.log); if (!logCh) return;
  logCh.send({embeds:[new EmbedBuilder().setColor(0xe74c3c).setTitle('👋 Üye Ayrıldı')
    .setDescription('**'+member.user.tag+'** sunucudan ayrıldı.')
    .setThumbnail(member.user.displayAvatarURL()).setTimestamp()]}).catch(()=>{});
});

// ── messageDelete ─────────────────────────────
client.on('messageDelete', async message=>{
  if (message.author?.bot||!message.guild||!message.content) return;
  const guild=getGuild(message.guild.id); const logCh=message.guild.channels.cache.get(guild.channels.log); if (!logCh) return;
  logCh.send({embeds:[new EmbedBuilder().setColor(0xe67e22).setTitle('🗑️ Mesaj Silindi')
    .addFields({name:'Kullanıcı',value:'<@'+message.author.id+'> ('+message.author.tag+')',inline:true},{name:'Kanal',value:'<#'+message.channelId+'>',inline:true},{name:'İçerik',value:message.content.slice(0,1000)||'—'})
    .setTimestamp()]}).catch(()=>{});
});

// ── messageUpdate ─────────────────────────────
client.on('messageUpdate', async(oldMsg,newMsg)=>{
  if (oldMsg.author?.bot||!oldMsg.guild||oldMsg.content===newMsg.content) return;
  const guild=getGuild(oldMsg.guild.id); const logCh=oldMsg.guild.channels.cache.get(guild.channels.log); if (!logCh) return;
  logCh.send({embeds:[new EmbedBuilder().setColor(0xf39c12).setTitle('✏️ Mesaj Düzenlendi')
    .addFields({name:'Kullanıcı',value:'<@'+oldMsg.author.id+'>',inline:true},{name:'Kanal',value:'<#'+oldMsg.channelId+'>',inline:true},{name:'Eski',value:(oldMsg.content||'—').slice(0,500)},{name:'Yeni',value:(newMsg.content||'—').slice(0,500)})
    .setTimestamp()]}).catch(()=>{});
});

// =============================================
//   CRON
// =============================================
cron.schedule('0 0 * * *',()=>{
  for (const u of Object.values(db.data.users)) {
    if (!u.dailyHistory) u.dailyHistory=[];
    u.dailyHistory.push({date:new Date().toLocaleDateString('tr-TR'),stats:{...u.stats}});
    if (u.dailyHistory.length>30) u.dailyHistory.shift();
    u.stats.dailyMessages=0; u.stats.dailyVoice=0;
  }
  saveDB();
},{timezone:'Europe/Istanbul'});

cron.schedule('*/5 * * * *',()=>{
  const now=Date.now();
  for (const [key,jt] of client.voiceMap.entries()) {
    const [gid,uid]=key.split('_'); const u=db.data.users[gid+'_'+uid]; if (!u) continue;
    const min=Math.floor((now-jt)/60000); if (min<=0) continue;
    u.stats.voiceMinutes+=min; u.stats.dailyVoice+=min;
    const g=db.data.guilds[gid]; if (g?.systems?.coin) u.coin=(u.coin||0)+min*(Number(process.env.COIN_PER_VOICE_MIN)||2);
    client.voiceMap.set(key,now);
  }
  saveDB();
});

// =============================================
//   WEB PANELİ & BAĞLAN
// =============================================
import('./server.js').then(m=>{ m.startWebPanel(client,db,saveDB); }).catch(console.error);
process.on('unhandledRejection',r=>console.error(chalk.red('[Hata]'),r));
process.on('uncaughtException',e=>console.error(chalk.red('[Kritik]'),e));

console.log(chalk.cyan(`
╔══════════════════════════════════════╗
║   ⚡  PROX BOT  v3.0  ⚡             ║
║      Başlatılıyor...                 ║
╚══════════════════════════════════════╝`));

client.login(process.env.DISCORD_TOKEN);
